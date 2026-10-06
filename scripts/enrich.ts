/**
 * Matches every film in the catalogue and watch log to TMDB, stores the full
 * TMDB record for each match (cast, crew, genres, keywords, titles, …), and
 * links items and watches to it.
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/enrich.ts --cloud
 *
 * Re-runnable: films already matched are skipped (add --rematch to re-check
 * auto/review/unmatched ones), and decisions made on the review page
 * (confirmed / rejected) are never overwritten. Writes only to DATABASE_URL;
 * refuses the production database unless --production is also given.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createDb } from "../src/db/client";
import { storeFilm } from "../src/db/enrich";
import { getMovieFull } from "../src/lib/tmdb";
import { matchFilm, type MatchResult } from "../src/lib/tmdb-match";

const args = new Set(process.argv.slice(2));
const CONCURRENCY = 5;

async function pool<T>(items: T[], fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

async function main() {
  if (!process.env.TMDB_READ_TOKEN) throw new Error("TMDB_READ_TOKEN is not set");
  const { db, client, kind, migrate } = createDb();
  if (kind !== "postgres" || !args.has("--cloud")) throw new Error("Run against a hosted database with DATABASE_URL set and --cloud.");
  const host = new URL(process.env.DATABASE_URL!).hostname;
  if (process.env.NEON_PROD_DATABASE_URL && new URL(process.env.NEON_PROD_DATABASE_URL).hostname === host && !args.has("--production")) {
    throw new Error(`DATABASE_URL is the production database (${host}). Add --production to really run against it.`);
  }
  const dryRun = args.has("--dry-run");
  console.log(`${dryRun ? "Dry run (nothing saved) against" : "Enriching"} ${host}`);
  if (!dryRun) await migrate("./drizzle");

  // One entry per film as entered (normalised title + year), with the spelling used most.
  const groups = (await client.query<{ match_key: string; title: string; release_year: number | null; picked: number[] | null; rows: number }>(`
    with entered as (
      select match_key, title, release_year, tmdb_id from items where item_type = 'film'
      union all
      select match_key, title, release_year, tmdb_id from watches)
    select match_key,
      (select e2.title from entered e2 where e2.match_key = e.match_key group by e2.title order by count(*) desc, e2.title limit 1) as title,
      max(release_year) as release_year,
      array_agg(distinct tmdb_id) filter (where tmdb_id is not null) as picked,
      count(*)::int as rows
    from entered e group by match_key`)).rows;

  const settled = dryRun ? new Set<string>() : new Set((await client.query<{ match_key: string }>(
    args.has("--rematch")
      ? `select match_key from tmdb_matches where status in ('confirmed', 'rejected')`
      : `select match_key from tmdb_matches`,
  )).rows.map((r) => r.match_key));
  const dryResults: { title: string; year: number | null; rows: number; status: string; result: MatchResult }[] = [];
  const todo = groups.filter((g) => !settled.has(g.match_key));
  console.log(`${groups.length} films as entered; ${todo.length} to match`);

  const tally: Record<string, number> = {};
  let done = 0;
  await pool(todo, async (g) => {
    let result: MatchResult;
    try {
      if (g.picked?.length === 1) {
        result = { status: "auto", tmdbId: g.picked[0], method: "already linked", candidates: [] };
      } else {
        result = await matchFilm(g.title, g.release_year);
      }
    } catch (e) {
      console.error(`  ! ${g.title} (${g.release_year}): ${(e as Error).message}`);
      tally.error = (tally.error ?? 0) + 1;
      return;
    }
    const status = result.method === "already linked" ? "confirmed" : result.status;
    if (dryRun) {
      dryResults.push({ title: g.title, year: g.release_year, rows: g.rows, status, result });
      tally[status] = (tally[status] ?? 0) + 1;
      if (++done % 100 === 0) console.log(`  matched ${done}/${todo.length}`, JSON.stringify(tally));
      return;
    }
    await client.query(
      `insert into tmdb_matches (match_key, title, release_year, status, tmdb_id, method, candidates, checked_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (match_key) do update set title = excluded.title, release_year = excluded.release_year, status = excluded.status,
         tmdb_id = excluded.tmdb_id, method = excluded.method, candidates = excluded.candidates, checked_at = now()
       where tmdb_matches.status not in ('confirmed', 'rejected')`,
      [g.match_key, g.title, g.release_year, status, result.tmdbId, result.method, JSON.stringify(result.candidates)],
    );
    tally[status] = (tally[status] ?? 0) + 1;
    if (++done % 100 === 0) console.log(`  matched ${done}/${todo.length}`, JSON.stringify(tally));
  });
  console.log("matching:", JSON.stringify(tally));

  if (dryRun) {
    writeDryRunReport(dryResults, tally);
    await client.close();
    return;
  }

  // Fetch and store the full record for every linked film not yet enriched.
  const toEnrich = (await client.query<{ tmdb_id: number }>(`
    select distinct m.tmdb_id from tmdb_matches m left join films f on f.tmdb_id = m.tmdb_id
    where m.status in ('auto', 'confirmed') and m.tmdb_id is not null and (f.enriched_at is null ${args.has("--refresh") ? "or true" : ""})`)).rows;
  console.log(`${toEnrich.length} films to fetch from TMDB`);
  let fetched = 0, failed = 0;
  await pool(toEnrich, async ({ tmdb_id }) => {
    try {
      await storeFilm(db, await getMovieFull(tmdb_id));
      if (++fetched % 100 === 0) console.log(`  fetched ${fetched}/${toEnrich.length}`);
    } catch (e) {
      failed++;
      console.error(`  ! TMDB #${tmdb_id}: ${(e as Error).message}`);
    }
  });
  console.log(`fetched ${fetched}, failed ${failed}`);

  // Link items and watches to their film. Never replaces an id picked in the app.
  const linked = await client.query<{ items: number; watches: number }>(`
    with i as (update items it set tmdb_id = m.tmdb_id from tmdb_matches m
               where it.match_key = m.match_key and it.tmdb_id is null and m.status in ('auto', 'confirmed') and m.tmdb_id is not null returning 1),
         w as (update watches wt set tmdb_id = m.tmdb_id from tmdb_matches m
               where wt.match_key = m.match_key and wt.tmdb_id is null and m.status in ('auto', 'confirmed') and m.tmdb_id is not null returning 1)
    select (select count(*) from i)::int as items, (select count(*) from w)::int as watches`);
  console.log("newly linked:", JSON.stringify(linked.rows[0]));

  const summary = await client.query<{ status: string; films: number }>(`select status::text, count(*)::int as films from tmdb_matches group by 1 order by 1`);
  const coverage = await client.query<{ items: string; watches: string }>(`
    select (select round(100.0 * count(tmdb_id) / nullif(count(*), 0)) from items where item_type = 'film')::text || '%' as items,
           (select round(100.0 * count(tmdb_id) / nullif(count(*), 0)) from watches)::text || '%' as watches`);
  console.log("\nmatch status:", summary.rows.map((r) => `${r.status} ${r.films}`).join(" · "));
  console.log("linked to TMDB:", `items ${coverage.rows[0].items}, watches ${coverage.rows[0].watches}`);
  await client.close();
}

/** reports/tmdb-dry-run.md: counts, reasons, and every film that would need review. */
function writeDryRunReport(results: { title: string; year: number | null; rows: number; status: string; result: MatchResult }[], tally: Record<string, number>) {
  const byMethod = new Map<string, number>();
  for (const r of results) byMethod.set(`${r.status}: ${r.result.method ?? "nothing found"}`, (byMethod.get(`${r.status}: ${r.result.method ?? "nothing found"}`) ?? 0) + 1);
  const label = (x: { title: string; year: number | null; rows: number }) => `${x.title} (${x.year ?? "no year"})${x.rows > 1 ? ` ×${x.rows}` : ""}`;
  const cands = (r: MatchResult) => r.candidates.slice(0, 3).map((c) => `${c.title} (${c.year ?? "?"}) – ${c.via}`).join("; ");
  const lines = [
    "# TMDB matching dry run", "", `Run ${new Date().toLocaleString("en-GB")}. Nothing was saved.`, "",
    "| Result | Films |", "|---|---|", ...Object.entries(tally).map(([k, v]) => `| ${k} | ${v} |`), "",
    "## Why", "", "| Result: reason | Films |", "|---|---|",
    ...[...byMethod].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`), "",
    "## Would need review", "",
    ...results.filter((r) => r.status === "review").sort((a, b) => a.title.localeCompare(b.title))
      .map((r) => `- **${label(r)}**: ${r.result.method}. Candidates: ${cands(r.result)}`), "",
    "## Nothing found", "",
    ...results.filter((r) => r.status === "unmatched").sort((a, b) => a.title.localeCompare(b.title))
      .map((r) => `- **${label(r)}**${r.result.candidates.length ? `. Closest: ${cands(r.result)}` : ""}`),
  ];
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/tmdb-dry-run.md", lines.join("\n") + "\n", "utf8");
  console.log("report: reports/tmdb-dry-run.md");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
