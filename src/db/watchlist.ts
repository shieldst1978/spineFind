import "server-only";
import { sql } from "drizzle-orm";
import { db } from ".";
import { OWNED_ORDER } from "./owned";
import { availabilityFor, subscribedIds, type ServicePick } from "./streaming";
import { IMDB_FILM_TYPES, parseCsv } from "@/lib/csv";
import { findByImdbId, type Availability } from "@/lib/tmdb";

export type SyncResult = {
  films: number; added: number; kept: number; removed: number;
  skippedSeen: number; skippedRemoved: number; skippedTv: number; notOnTmdb: number; newTmdbIds: number[];
};

/**
 * Brings the watchlist in line with an IMDb watchlist export: adds films that are new, drops films no
 * longer on IMDb, and leaves out TV, films already seen (watched or marked seen) and films you removed
 * in the app, so neither comes back. Films added in the app stay whatever IMDb says.
 * Returns the TMDB ids that still need their full record fetching.
 */
export async function syncWatchlist(csv: string): Promise<SyncResult> {
  const rows = parseCsv(csv);
  if (!rows.length || !("Const" in rows[0])) throw new Error("That doesn't look like an IMDb list export (no Const column).");
  const films = rows.filter((r) => IMDB_FILM_TYPES.has(r["Title Type"] ?? "") && /^tt\d+$/.test(r.Const));

  const known = new Map((await db.execute<{ imdb_id: string; tmdb_id: number }>(sql`select imdb_id, tmdb_id from films where imdb_id is not null`)).rows.map((r) => [r.imdb_id, r.tmdb_id]));
  const listed = new Map((await db.execute<{ imdb_id: string; tmdb_id: number }>(sql`select imdb_id, tmdb_id from watchlist where imdb_id is not null`)).rows.map((r) => [r.imdb_id, r.tmdb_id]));
  const toFind = films.filter((r) => !known.has(r.Const) && !listed.has(r.Const));
  const found = new Map<string, number | null>();
  let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < toFind.length) { const r = toFind[next++]; found.set(r.Const, await findByImdbId(r.Const).catch(() => null)); }
  }));

  const seen = new Set((await db.execute<{ tmdb_id: number }>(sql`select tmdb_id from assistant_films where watched and tmdb_id is not null`)).rows.map((r) => r.tmdb_id));
  const removedHere = new Set((await db.execute<{ tmdb_id: number }>(sql`select tmdb_id from watchlist_removed`)).rows.map((r) => r.tmdb_id));
  const result: SyncResult = { films: films.length, added: 0, kept: 0, removed: 0, skippedSeen: 0, skippedRemoved: 0, skippedTv: rows.length - films.length, notOnTmdb: 0, newTmdbIds: [] };
  const wanted = new Map<number, { imdbId: string; title: string; year: number | null; addedOn: string | null }>();
  for (const r of films) {
    const id = known.get(r.Const) ?? listed.get(r.Const) ?? found.get(r.Const) ?? null;
    if (!id) { result.notOnTmdb++; continue; }
    if (seen.has(id)) { result.skippedSeen++; continue; }
    if (removedHere.has(id)) { result.skippedRemoved++; continue; }
    wanted.set(id, { imdbId: r.Const, title: r.Title, year: Number(r.Year) || null, addedOn: /^\d{4}-\d{2}-\d{2}$/.test(r.Created ?? "") ? r.Created : null });
  }

  const before = new Set((await db.execute<{ tmdb_id: number }>(sql`select tmdb_id from watchlist where source = 'imdb'`)).rows.map((r) => r.tmdb_id));
  const ids = [...wanted.keys()];
  await db.transaction(async (tx) => {
    // Gone from IMDb (or now seen): off the list. Films added in the app (other sources) stay.
    const gone = [...before].filter((id) => !wanted.has(id));
    if (gone.length) await tx.execute(sql`delete from watchlist where source = 'imdb' and tmdb_id in ${gone}`);
    result.removed = gone.length;
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200).map((id) => ({ id, ...wanted.get(id)! }));
      await tx.execute(sql`
        insert into watchlist (film_key, tmdb_id, imdb_id, title, release_year, added_on, source)
        select 'tmdb:' || x.id, x.id, x.imdb, x.title, x.year, x.added, 'imdb'
        from unnest(${sql.param(batch.map((b) => b.id))}::int[],
                    ${sql.param(batch.map((b) => b.imdbId))}::text[], ${sql.param(batch.map((b) => b.title))}::text[],
                    ${sql.param(batch.map((b) => b.year))}::int[], ${sql.param(batch.map((b) => b.addedOn))}::date[]) as x(id, imdb, title, year, added)
        on conflict (film_key) do update set imdb_id = excluded.imdb_id, added_on = coalesce(watchlist.added_on, excluded.added_on)`);
    }
  });
  result.added = ids.filter((id) => !before.has(id)).length;
  result.kept = ids.length - result.added;
  const enriched = new Set((await db.execute<{ tmdb_id: number }>(sql`select tmdb_id from films where enriched_at is not null`)).rows.map((r) => r.tmdb_id));
  result.newTmdbIds = ids.filter((id) => !enriched.has(id));
  return result;
}

/** Takes films off the watchlist once they're watched or marked seen. Keys are film_keys ('tmdb:<id>' or title|year). */
export async function removeFromWatchlist(filmKeys: (string | null | undefined)[]) {
  const keys = [...new Set(filmKeys.filter((k): k is string => !!k))];
  if (keys.length) await db.execute(sql`delete from watchlist where film_key in ${keys}`);
}

/** Adds a film in the app (source 'app'), forgetting any earlier removal. No-op if it's already listed. */
export async function addToWatchlist(m: { tmdbId: number; title: string; year: number | null }) {
  const key = `tmdb:${m.tmdbId}`;
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from watchlist_removed where film_key = ${key}`);
    await tx.execute(sql`
      insert into watchlist (film_key, tmdb_id, title, release_year, added_on, source)
      values (${key}, ${m.tmdbId}, ${m.title}, ${m.year}, current_date, 'app') on conflict (film_key) do nothing`);
  });
}

/** Takes a film off because you no longer want it: remembered, so an IMDb upload won't re-add it. Returns its title. */
export async function dropFromWatchlist(filmKey: string): Promise<string | null> {
  const r = await db.execute<{ title: string }>(sql`
    with d as (delete from watchlist where film_key = ${filmKey} returning *)
    insert into watchlist_removed (film_key, tmdb_id, imdb_id, title, release_year, added_on, source)
    select film_key, tmdb_id, imdb_id, title, release_year, added_on, source from d
    on conflict (film_key) do update set tmdb_id = excluded.tmdb_id, imdb_id = excluded.imdb_id, title = excluded.title,
      release_year = excluded.release_year, added_on = excluded.added_on, source = excluded.source, removed_at = now()
    returning title`);
  return r.rows[0]?.title ?? null;
}

/** Undoes a removal: the film goes back exactly as it was (same source and date added). */
export async function restoreToWatchlist(filmKey: string) {
  await db.execute(sql`
    with r as (delete from watchlist_removed where film_key = ${filmKey} returning *)
    insert into watchlist (film_key, tmdb_id, imdb_id, title, release_year, added_on, source)
    select film_key, tmdb_id, imdb_id, title, release_year, added_on, source from r
    on conflict (film_key) do nothing`);
}

/** For TMDB search results on the watchlist page: which are already listed, seen, or owned. */
export async function watchlistStatus(tmdbIds: number[]) {
  const ids = tmdbIds.length ? tmdbIds : [0];
  const r = await db.execute<{ tmdb_id: number; listed: boolean; seen: boolean; owned: boolean }>(sql`
    select x.id as tmdb_id,
      exists (select 1 from watchlist w where w.tmdb_id = x.id) as listed,
      exists (select 1 from assistant_films a where a.tmdb_id = x.id and a.watched) as seen,
      exists (select 1 from items i join products p on p.id = i.product_id where i.tmdb_id = x.id and p.location <> 'gone') as owned
    from unnest(${sql.param(ids)}::int[]) as x(id)`);
  return new Map(r.rows.map((s) => [s.tmdb_id, s]));
}

export type WatchlistEntry = {
  filmKey: string; tmdbId: number; title: string; year: number | null; addedOn: string | null;
  posterPath: string | null; runtime: number | null; genres: string[]; score: number | null;
  owned: { itemId: string; where: string; box: string; spine: string } | null;
  /** Which of your services it's streaming (or free) on; null when availability hasn't been checked yet. */
  services: string[] | null;
  rentable: boolean;
};

/** The watchlist with what you need to choose: your copy if you own it, and where it's streaming. */
export async function listWatchlist(): Promise<WatchlistEntry[]> {
  const mine = new Set(await subscribedIds());
  const r = await db.execute<{
    film_key: string; tmdb_id: number; title: string; release_year: number | null; added_on: string | null;
    poster_path: string | null; runtime_minutes: number | null; genres: string[] | null; vote_average: number | null;
    item_id: string | null; location: string | null; box: string | null; spine: string | null; offers: Availability | null;
  }>(sql`
    select w.film_key, w.tmdb_id, coalesce(own.title, w.title) as title, coalesce(own.release_year, w.release_year) as release_year,
      w.added_on::text as added_on, f.poster_path, f.runtime_minutes, f.genres, f.vote_average,
      own.id as item_id, own.location, own.box, own.spine, a.offers
    from watchlist w
    left join films f on f.tmdb_id = w.tmdb_id
    left join film_availability a on a.tmdb_id = w.tmdb_id
    left join lateral (
      select i.id, i.title, i.release_year, p.location::text as location, p.title as box, array_to_string(p.spine_colours, ' / ') as spine
      from items i join products p on p.id = i.product_id
      where i.tmdb_id = w.tmdb_id and p.location <> 'gone' order by ${OWNED_ORDER} limit 1) own on true
    order by w.added_on desc nulls last, lower(w.title)`);
  return r.rows.map((x) => {
    const o = x.offers;
    return {
      filmKey: x.film_key, tmdbId: x.tmdb_id, title: x.title, year: x.release_year, addedOn: x.added_on,
      posterPath: x.poster_path, runtime: x.runtime_minutes, genres: x.genres ?? [], score: x.vote_average,
      owned: x.item_id ? { itemId: x.item_id, where: x.location!, box: x.box!, spine: x.spine! } : null,
      services: o ? [...new Set([...o.stream, ...o.free, ...o.ads].filter((s) => mine.has(s.providerId)).map((s) => s.name))] : null,
      rentable: o ? o.rent.length + o.buy.length > 0 : false,
    };
  });
}

/**
 * Random films from the watchlist for Pick: optionally only ones you can watch tonight (on your shelf
 * or streaming on your services), and from a decade. Shaped like a streaming pick so it shares the card.
 */
export type WatchlistWhere = "shelf" | "services" | "either";

export async function watchlistSize(): Promise<number> {
  return (await db.execute<{ n: number }>(sql`select count(*)::int as n from watchlist`)).rows[0]?.n ?? 0;
}

export async function pickFromWatchlist(c: { decade?: number; exclude?: number[]; where?: WatchlistWhere }, count = 4) {
  const all = await listWatchlist();
  const exclude = new Set(c.exclude ?? []);
  let pool = all.filter((e) => !exclude.has(e.tmdbId) && (c.decade === undefined || (e.year !== null && Math.floor(e.year / 10) * 10 === c.decade)));
  const onShelf = (e: WatchlistEntry) => e.owned?.where === "shelf" || e.owned?.where === "plex";
  const streaming = (e: WatchlistEntry) => (e.services?.length ?? 0) > 0;
  const where = c.where ?? "either";
  pool = pool.filter((e) => (where === "shelf" ? onShelf(e) : where === "services" ? streaming(e) && !onShelf(e) : onShelf(e) || streaming(e)));
  const total = pool.length;
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picks = await Promise.all(pool.slice(0, count).map(async (e): Promise<ServicePick & { rentable: boolean }> => {
    // The main pick's availability is re-checked if it's stale; the rest use the cached answer.
    let services = e.services;
    let rentable = e.rentable;
    if (services === null) {
      const w = await availabilityFor(e.tmdbId);
      services = w ? [...new Set([...w.stream, ...w.free, ...w.ads].filter((s) => w.mine.has(s.providerId)).map((s) => s.name))] : [];
      rentable = w ? w.rent.length + w.buy.length > 0 : false;
    }
    return {
      tmdbId: e.tmdbId, title: e.title, year: e.year, posterPath: e.posterPath, times: 0, lastWatched: null,
      owned: e.owned ? { itemId: e.owned.itemId, location: e.owned.where } : null, services, rentable,
    };
  }));
  return { total, picks, checking: all.some((e) => e.services === null) };
}
