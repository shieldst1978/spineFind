import "server-only";
import { sql } from "drizzle-orm";
import { db } from ".";
import { IMDB_FILM_TYPES, parseCsv } from "@/lib/csv";
import { findByImdbId } from "@/lib/tmdb";

export type SeenImport = {
  rows: number; films: number; skippedTv: number; notOnTmdb: number;
  logged: number; alreadySeen: number; marked: number; newToSpineFind: number; offWatchlist: number;
  newTmdbIds: number[];
  sample: string[];
};

/**
 * Records the films in an IMDb watch-history or ratings CSV as "films seen" (seen_films, source 'imdb'):
 * TV is skipped, films are matched to TMDB by IMDb id, and films with a logged watch or already marked
 * are left alone. Discs are never marked watched. Newly seen films come off the watchlist.
 * Returns the TMDB ids still needing their full record. Re-runnable.
 */
export async function importSeenFromImdb(csv: string, opts: { dryRun?: boolean } = {}): Promise<SeenImport> {
  const rows = parseCsv(csv);
  if (!rows.length || !("Const" in rows[0])) throw new Error("That doesn't look like an IMDb export (no Const column).");
  const films = rows.filter((r) => IMDB_FILM_TYPES.has(r["Title Type"] ?? r.titleType ?? "") && /^tt\d+$/.test(r.Const ?? ""));

  // IMDb id → TMDB id: known films first, then TMDB's lookup (five at a time).
  const known = new Map((await db.execute<{ imdb_id: string; tmdb_id: number }>(sql`select imdb_id, tmdb_id from films where imdb_id is not null`)).rows.map((r) => [r.imdb_id, r.tmdb_id]));
  const toFind = films.filter((r) => !known.has(r.Const));
  const found = new Map<string, number | null>();
  let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < toFind.length) { const r = toFind[next++]; found.set(r.Const, await findByImdbId(r.Const).catch(() => null)); }
  }));

  const inApp = new Map((await db.execute<{ tmdb_id: number; title: string; release_year: number | null; times_watched: number }>(sql`
    select tmdb_id, title, release_year, times_watched from assistant_films where tmdb_id is not null`)).rows.map((r) => [r.tmdb_id, r]));
  const already = new Set((await db.execute<{ film_key: string }>(sql`select film_key from seen_films`)).rows.map((r) => r.film_key));

  const out: SeenImport = { rows: rows.length, films: films.length, skippedTv: rows.length - films.length, notOnTmdb: 0, logged: 0, alreadySeen: 0, marked: 0, newToSpineFind: 0, offWatchlist: 0, newTmdbIds: [], sample: [] };
  const toMark = new Map<string, { tmdbId: number; title: string; year: number | null }>();
  for (const r of films) {
    const id = known.get(r.Const) ?? found.get(r.Const) ?? null;
    if (!id) { out.notOnTmdb++; continue; }
    const mine = inApp.get(id);
    if (mine && mine.times_watched > 0) { out.logged++; continue; } // a logged watch already says so
    const key = `tmdb:${id}`;
    if (already.has(key) || toMark.has(key)) { out.alreadySeen++; continue; }
    // Your own title and year where SpineFind has the film; IMDb's otherwise.
    toMark.set(key, { tmdbId: id, title: mine?.title ?? r.Title, year: mine?.release_year ?? (Number(r.Year) || null) });
    if (!mine) out.newToSpineFind++;
  }
  out.marked = toMark.size;
  out.sample = [...toMark.values()].slice(0, 15).map((m) => `${m.title} (${m.year ?? "?"})`);
  if (opts.dryRun || !toMark.size) return out;

  const marks = [...toMark.entries()];
  for (let i = 0; i < marks.length; i += 200) {
    const batch = marks.slice(i, i + 200);
    await db.execute(sql`
      insert into seen_films (film_key, tmdb_id, title, release_year, source)
      select k, id, t, y, 'imdb' from unnest(${sql.param(batch.map(([k]) => k))}::text[], ${sql.param(batch.map(([, m]) => m.tmdbId))}::int[],
        ${sql.param(batch.map(([, m]) => m.title))}::text[], ${sql.param(batch.map(([, m]) => m.year))}::int[]) as x(k, id, t, y)
      on conflict (film_key) do nothing`);
  }
  const off = await db.execute<{ n: number }>(sql`
    with d as (delete from watchlist where film_key = any(${sql.param(marks.map(([k]) => k))}::text[]) returning 1) select count(*)::int as n from d`);
  out.offWatchlist = off.rows[0]?.n ?? 0;
  const enriched = new Set((await db.execute<{ tmdb_id: number }>(sql`select tmdb_id from films where enriched_at is not null`)).rows.map((r) => r.tmdb_id));
  out.newTmdbIds = [...new Set(marks.map(([, m]) => m.tmdbId))].filter((id) => !enriched.has(id));
  return out;
}
