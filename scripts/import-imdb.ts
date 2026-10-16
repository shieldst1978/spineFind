/**
 * Imports an IMDb watch-history CSV (no dates or ratings) as "films seen":
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/import-imdb.ts --cloud [--dry-run] [--production] [file.csv]
 *
 * Each film (TV series, episodes and games are skipped) is matched to TMDB by its IMDb id and recorded in
 * seen_films with source 'imdb', unless it already has a logged watch. Discs are never marked watched: the
 * shelf's ✓ stays for copies actually watched. Films new to SpineFind get their full TMDB record.
 * Re-runnable: films already marked seen are left alone.
 */
import { readFileSync } from "node:fs";
import { createDb } from "../src/db/client";
import { storeFilm } from "../src/db/enrich";
import { IMDB_FILM_TYPES, parseCsv } from "../src/lib/csv";
import { getMovieFull } from "../src/lib/tmdb";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const file = args.find((a) => !a.startsWith("--")) ?? "imdb_exports/imdb_watch_history.csv";

async function tmdbForImdb(imdbId: string): Promise<number | null> {
  const r = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`, {
    headers: { Authorization: `Bearer ${process.env.TMDB_READ_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`TMDB find ${imdbId}: ${r.status}`);
  const j = (await r.json()) as { movie_results?: { id: number }[] };
  return j.movie_results?.[0]?.id ?? null;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) await fn(items[next++]); }));
}

async function main() {
  if (!process.env.TMDB_READ_TOKEN) throw new Error("TMDB_READ_TOKEN is not set");
  const { db, client, kind, migrate } = createDb();
  if (kind !== "postgres" || !flags.has("--cloud")) throw new Error("Run against a hosted database with DATABASE_URL set and --cloud.");
  const host = new URL(process.env.DATABASE_URL!).hostname;
  if (process.env.NEON_PROD_DATABASE_URL && new URL(process.env.NEON_PROD_DATABASE_URL).hostname === host && !flags.has("--production")) {
    throw new Error(`DATABASE_URL is the production database (${host}). Add --production to really run against it.`);
  }
  const dry = flags.has("--dry-run");
  console.log(`${dry ? "Dry run (nothing saved) against" : "Importing into"} ${host} from ${file}`);
  if (!dry) await migrate("./drizzle");

  const rows = parseCsv(readFileSync(file, "utf8"));
  const typeOf = (r: Record<string, string>) => r["Title Type"] ?? r.titleType ?? "";
  const films = rows.filter((r) => IMDB_FILM_TYPES.has(typeOf(r)) && /^tt\d+$/.test(r.Const ?? ""));
  console.log(`${rows.length} rows; ${films.length} films (${rows.length - films.length} TV, games or unreadable skipped)`);

  // IMDb id → TMDB id: known films first, then TMDB's lookup.
  const known = new Map((await client.query<{ imdb_id: string; tmdb_id: number }>(`select imdb_id, tmdb_id from films where imdb_id is not null`)).rows.map((r) => [r.imdb_id, r.tmdb_id]));
  const tmdb = new Map<string, number | null>();
  await pool(films.filter((r) => !known.has(r.Const)), 5, async (r) => { tmdb.set(r.Const, await tmdbForImdb(r.Const).catch(() => null)); });
  const idOf = (r: Record<string, string>) => known.get(r.Const) ?? tmdb.get(r.Const) ?? null;

  const inApp = new Map((await client.query<{ tmdb_id: number; title: string; release_year: number | null; times_watched: number }>(
    `select tmdb_id, title, release_year, times_watched from assistant_films where tmdb_id is not null`)).rows.map((r) => [r.tmdb_id, r]));
  const already = new Set((await client.query<{ film_key: string }>(`select film_key from seen_films`)).rows.map((r) => r.film_key));

  const tally = { notOnTmdb: 0, logged: 0, alreadySeen: 0, marked: 0, ownedOrKnown: 0, newToSpineFind: 0 };
  const toMark: { key: string; tmdbId: number; title: string; year: number | null }[] = [];
  for (const r of films) {
    const id = idOf(r);
    if (!id) { tally.notOnTmdb++; continue; }
    const mine = inApp.get(id);
    if (mine && mine.times_watched > 0) { tally.logged++; continue; } // has a logged watch: nothing to add
    const key = `tmdb:${id}`;
    if (already.has(key) || toMark.some((m) => m.key === key)) { tally.alreadySeen++; continue; }
    // Keep your own title and year where SpineFind has the film; IMDb's otherwise.
    toMark.push({ key, tmdbId: id, title: mine?.title ?? r.Title, year: mine?.release_year ?? (Number(r.Year) || null) });
    if (mine) tally.ownedOrKnown++; else tally.newToSpineFind++;
  }
  tally.marked = toMark.length;
  console.log("result:", JSON.stringify(tally));
  if (dry) {
    console.log("would mark, e.g.:", toMark.slice(0, 15).map((m) => `${m.title} (${m.year})`).join("; "));
    await client.close();
    return;
  }

  for (let i = 0; i < toMark.length; i += 200) {
    const batch = toMark.slice(i, i + 200);
    await client.query(
      `insert into seen_films (film_key, tmdb_id, title, release_year, source)
       select * from unnest($1::text[], $2::int[], $3::text[], $4::int[], array_fill('imdb'::text, array[$5::int]))
       on conflict (film_key) do nothing`,
      [batch.map((m) => m.key), batch.map((m) => m.tmdbId), batch.map((m) => m.title), batch.map((m) => m.year), batch.length],
    );
  }
  console.log(`marked ${toMark.length} films as seen (source imdb)`);

  // Films new to SpineFind get cast, crew, genres etc. so Stats, Pick and Ask can use them.
  const enriched = new Set((await client.query<{ tmdb_id: number }>(`select tmdb_id from films where enriched_at is not null`)).rows.map((r) => r.tmdb_id));
  const fetch_ = [...new Set(toMark.map((m) => m.tmdbId))].filter((id) => !enriched.has(id));
  let ok = 0, failed = 0;
  await pool(fetch_, 4, async (id) => {
    try { await storeFilm(db, await getMovieFull(id)); ok++; } catch (e) { failed++; console.error(`  ! TMDB #${id}: ${(e as Error).message}`); }
  });
  console.log(`fetched ${ok} TMDB records, failed ${failed}`);
  await client.close();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
