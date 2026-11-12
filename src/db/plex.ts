import { sql } from "drizzle-orm";
import { db } from ".";
import { linkTmdbId } from "./film-link";
import { matchKey } from "@/lib/match-key";
import { findByImdbId } from "@/lib/tmdb";

/** One film from the Plex library, as scripts/plex-sync.ts reads it. */
export type PlexFilm = {
  /** Plex's own id for the film (plex://movie/…), stable across rescans and file moves. */
  guid: string;
  title: string;
  year: number | null;
  tmdbId: number | null;
  imdbId: string | null;
  /** Best copy's resolution as Plex reports it: "sd", "480", "576", "720", "1080", "4k". */
  resolution: string | null;
};

export type PlexSync = {
  films: number;
  added: number;
  updated: number;
  removed: number;
  unlinked: string[];
  newTmdbIds: number[];
};

const RES: Record<string, string> = { sd: "SD", "4k": "4K" };
const quality = (r: string | null) => (r ? (RES[r.toLowerCase()] ?? `${r}p`) : null);

/**
 * Makes the 'plex' boxes match the Plex library: one spineless box (location 'plex', format 'Plex') per
 * film, keyed on the Plex guid. New films are added, changed ones updated, films gone from Plex removed.
 * Watches and seen marks hang off the film, not the box, so removing a box never loses history.
 */
export async function syncPlexFilms(films: PlexFilm[], opts: { dryRun?: boolean } = {}): Promise<PlexSync> {
  const existing = new Map(
    (await db.execute<{ id: string; guid: string; title: string; year: number | null; tmdb_id: number | null; notes: string | null }>(sql`
      select p.id, p.plex_guid as guid, i.title, i.release_year as year, i.tmdb_id, p.notes
      from products p join items i on i.product_id = p.id where p.location = 'plex'`)).rows.map((r) => [r.guid, r]),
  );
  const known = new Set((await db.execute<{ tmdb_id: number }>(sql`select tmdb_id from films`)).rows.map((r) => r.tmdb_id));

  const rows: { guid: string; title: string; year: number | null; tmdbId: number | null; notes: string | null }[] = [];
  const unlinked: string[] = [];
  for (const f of films) {
    const prev = existing.get(f.guid);
    // Plex's TMDB id when it has one; else look the IMDb id up on TMDB; else link as the app would a typed title.
    let tmdbId = f.tmdbId ?? prev?.tmdb_id ?? null;
    if (!tmdbId && f.imdbId) tmdbId = await findByImdbId(f.imdbId);
    if (!tmdbId) tmdbId = await linkTmdbId(f.title, f.year, null);
    if (!tmdbId) unlinked.push(`${f.title}${f.year ? ` (${f.year})` : ""}`);
    rows.push({ guid: f.guid, title: f.title, year: f.year, tmdbId, notes: quality(f.resolution) });
  }

  const seen = new Set(rows.map((r) => r.guid));
  const added = rows.filter((r) => !existing.has(r.guid));
  const changed = rows.filter((r) => {
    const p = existing.get(r.guid);
    return p && (p.title !== r.title || p.year !== r.year || p.tmdb_id !== r.tmdbId || p.notes !== r.notes);
  });
  const gone = [...existing.values()].filter((p) => !seen.has(p.guid));
  const result: PlexSync = {
    films: films.length,
    added: added.length,
    updated: changed.length,
    removed: gone.length,
    unlinked,
    newTmdbIds: [...new Set(rows.map((r) => r.tmdbId).filter((id): id is number => id !== null && !known.has(id)))],
  };
  if (opts.dryRun) return result;

  await db.transaction(async (tx) => {
    for (let i = 0; i < added.length; i += 200) {
      const batch = added.slice(i, i + 200);
      await tx.execute(sql`
        with p as (
          insert into products (title, spine_colours, location, notes, plex_guid)
          select t.title, '{}', 'plex', t.notes, t.guid
          from unnest(${sql.param(batch.map((r) => r.guid))}::text[], ${sql.param(batch.map((r) => r.title))}::text[],
                      ${sql.param(batch.map((r) => r.notes))}::text[]) as t(guid, title, notes)
          returning id, plex_guid
        )
        insert into items (product_id, position, title, release_year, item_type, format, match_key, tmdb_id)
        select p.id, 1, t.title, t.year, 'film', 'Plex', t.mkey, t.tmdb_id
        from p join unnest(${sql.param(batch.map((r) => r.guid))}::text[], ${sql.param(batch.map((r) => r.title))}::text[],
                           ${sql.param(batch.map((r) => r.year))}::int[], ${sql.param(batch.map((r) => matchKey(r.title, r.year)))}::text[],
                           ${sql.param(batch.map((r) => r.tmdbId))}::int[]) as t(guid, title, year, mkey, tmdb_id)
          on t.guid = p.plex_guid`);
    }
    for (const r of changed) {
      const id = existing.get(r.guid)!.id;
      await tx.execute(sql`update products set title = ${r.title}, notes = ${r.notes}, updated_at = now() where id = ${id}`);
      await tx.execute(sql`
        update items set title = ${r.title}, release_year = ${r.year}, match_key = ${matchKey(r.title, r.year)},
          tmdb_id = ${r.tmdbId}, updated_at = now()
        where product_id = ${id}`);
    }
    if (gone.length) {
      await tx.execute(sql`delete from products where location = 'plex' and id = any(${sql.param(gone.map((p) => p.id))}::uuid[])`);
    }
  });
  return result;
}
