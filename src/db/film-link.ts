import "server-only";
import { sql } from "drizzle-orm";
import { db } from ".";
import { cacheFilm } from "./films";
import { matchKey } from "@/lib/match-key";
import { tmdbEnabled } from "@/lib/tmdb";

/**
 * The TMDB film for a box entry or watch being saved. A film picked from the
 * suggestions brings its own ID (and settles that title + year for next time);
 * otherwise it inherits the link of the same title + year already in the app,
 * so a re-typed film still counts as the same film.
 */
export async function linkTmdbId(title: string, year: number | null, picked: number | null): Promise<number | null> {
  const key = matchKey(title, year);
  if (picked) {
    await rememberPick(key, title, year, picked);
    return picked;
  }
  const r = await db.execute<{ tmdb_id: number }>(sql`
    select tmdb_id from (
      select tmdb_id, 0 as pref from tmdb_matches where match_key = ${key} and status in ('auto', 'confirmed')
      union all select tmdb_id, 1 from items where match_key = ${key}
      union all select tmdb_id, 1 from watches where match_key = ${key}
    ) k where tmdb_id is not null order by pref limit 1`);
  return r.rows[0]?.tmdb_id ?? null;
}

/** A pick in the app answers any open review for that title + year and links its other unlinked entries. */
async function rememberPick(key: string, title: string, year: number | null, tmdbId: number) {
  await db.execute(sql`
    insert into tmdb_matches (match_key, title, release_year, status, tmdb_id, method, candidates, checked_at)
    values (${key}, ${title}, ${year}, 'confirmed', ${tmdbId}, 'picked in the app', '[]', now())
    on conflict (match_key) do update set status = 'confirmed', tmdb_id = excluded.tmdb_id, method = excluded.method, checked_at = now()
    where tmdb_matches.status <> 'confirmed'`);
  await db.execute(sql`update items set tmdb_id = ${tmdbId} where match_key = ${key} and tmdb_id is null`);
  await db.execute(sql`update watches set tmdb_id = ${tmdbId} where match_key = ${key} and tmdb_id is null`);
}

/** Fetches cast, crew, genres etc. for films not yet stored. Failures are logged and skipped. */
export async function enrichFilms(ids: (number | null)[]) {
  if (!tmdbEnabled()) return;
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
  if (!wanted.length) return;
  const done = await db.execute<{ tmdb_id: number }>(sql`
    select tmdb_id from films where enriched_at is not null and tmdb_id in ${wanted}`);
  const known = new Set(done.rows.map((r) => r.tmdb_id));
  await Promise.all(wanted.filter((id) => !known.has(id)).map((id) => cacheFilm(id)));
}
