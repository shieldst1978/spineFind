import "server-only";
import { asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from ".";
import { filmAvailability, seenFilms, streamingServices } from "./schema";
import { discoverOnServices, getUkAvailability, listUkProviders, tmdbEnabled, type Availability, type TmdbSearchResult } from "@/lib/tmdb";

const SERVICES_MAX_AGE_DAYS = 30;
const AVAILABILITY_MAX_AGE_HOURS = 24;

export type StreamingService = typeof streamingServices.$inferSelect;

/**
 * The UK services list, refreshed from TMDB once a month (new services appear,
 * names change). Your ticks are kept across refreshes.
 */
export async function listServices(): Promise<StreamingService[]> {
  const [newest] = await db.select({ at: streamingServices.updatedAt }).from(streamingServices).orderBy(desc(streamingServices.updatedAt)).limit(1);
  const stale = !newest || Date.now() - newest.at.getTime() > SERVICES_MAX_AGE_DAYS * 864e5;
  if (stale && tmdbEnabled()) {
    try {
      const providers = await listUkProviders();
      if (providers.length) {
        await db.insert(streamingServices)
          .values(providers.map((p) => ({ providerId: p.providerId, name: p.name, logoPath: p.logoPath, priority: p.priority, updatedAt: new Date() })))
          .onConflictDoUpdate({
            target: streamingServices.providerId,
            set: { name: sql`excluded.name`, logoPath: sql`excluded.logo_path`, priority: sql`excluded.priority`, updatedAt: sql`excluded.updated_at` },
          });
      }
    } catch (e) {
      console.error("TMDB provider list failed", e);
    }
  }
  return db.select().from(streamingServices).orderBy(desc(streamingServices.subscribed), asc(streamingServices.priority), asc(streamingServices.name));
}

/** Replaces the set of services you subscribe to. */
export async function setSubscribed(providerIds: number[]) {
  await db.transaction(async (tx) => {
    await tx.update(streamingServices).set({ subscribed: false }).where(eq(streamingServices.subscribed, true));
    if (providerIds.length) {
      await tx.update(streamingServices).set({ subscribed: true }).where(sql`${streamingServices.providerId} in ${providerIds}`);
    }
  });
}

export type FilmAvailability = Availability & { mine: Set<number> };

/** Where a film can be watched in the UK, with the services you have marked. Null if TMDB can't be reached. */
export async function availabilityFor(tmdbId: number): Promise<FilmAvailability | null> {
  const [cached] = await db.select().from(filmAvailability).where(eq(filmAvailability.tmdbId, tmdbId));
  let offers = cached && Date.now() - cached.fetchedAt.getTime() < AVAILABILITY_MAX_AGE_HOURS * 36e5 ? (cached.offers as Availability) : null;
  if (!offers && tmdbEnabled()) {
    try {
      offers = await getUkAvailability(tmdbId);
      await db.insert(filmAvailability).values({ tmdbId, offers, fetchedAt: new Date() })
        .onConflictDoUpdate({ target: filmAvailability.tmdbId, set: { offers, fetchedAt: new Date() } });
    } catch (e) {
      console.error("TMDB availability failed", tmdbId, e);
      offers = cached ? (cached.offers as Availability) : null;
    }
  }
  if (!offers) return null;
  const mine = new Set((await db.select({ id: streamingServices.providerId }).from(streamingServices).where(eq(streamingServices.subscribed, true))).map((s) => s.id));
  return { ...offers, mine };
}


export async function subscribedIds(): Promise<number[]> {
  return (await db.select({ id: streamingServices.providerId }).from(streamingServices).where(eq(streamingServices.subscribed, true))).map((s) => s.id);
}

const refreshing = new Set<string>();

/**
 * Re-checks UK availability for every film in your watch log whose cached
 * answer is missing or over a day old, so "rewatch on my services" has
 * something to choose from. Runs in the background; one run at a time.
 */
export async function refreshLogAvailability() {
  await refreshStale("log", sql`select distinct tmdb_id from watches where tmdb_id is not null`);
}

/** The same for the watchlist, so its page and Pick know what's streaming. */
export async function refreshWatchlistAvailability() {
  await refreshStale("watchlist", sql`select tmdb_id from watchlist`);
}

/** Fetches availability for the films `ids` selects whose cached answer is missing or stale. One run per name at a time. */
async function refreshStale(name: string, ids: SQL) {
  if (refreshing.has(name) || !tmdbEnabled()) return;
  refreshing.add(name);
  try {
    const stale = (await db.execute<{ tmdb_id: number }>(sql`
      select x.tmdb_id from (${ids}) x left join film_availability a on a.tmdb_id = x.tmdb_id
      where a.tmdb_id is null or a.fetched_at < now() - interval '${sql.raw(String(AVAILABILITY_MAX_AGE_HOURS))} hours'`)).rows;
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < stale.length) {
        const { tmdb_id } = stale[next++];
        try {
          const offers = await getUkAvailability(tmdb_id);
          await db.insert(filmAvailability).values({ tmdbId: tmdb_id, offers, fetchedAt: new Date() })
            .onConflictDoUpdate({ target: filmAvailability.tmdbId, set: { offers, fetchedAt: new Date() } });
        } catch (e) {
          console.error("TMDB availability failed", tmdb_id, (e as Error).message);
        }
      }
    }));
  } finally {
    refreshing.delete(name);
  }
}

export type ServicePick = {
  tmdbId: number;
  /** Your title if it's in your log or collection, otherwise TMDB's. */
  title: string;
  year: number | null;
  posterPath: string | null;
  times: number;
  lastWatched: string | null;
  owned: { itemId: string; location: string } | null;
  /** Which of your services it's on (in the subscription or free). */
  services: string[];
};

export type ServiceCriteria = { mode: "unwatched" | "rewatch" | "any"; decade?: number; notSeenYears?: number; exclude?: number[] };

/**
 * Random films on your services. Unwatched (or anything) comes from TMDB's
 * catalogue of what's on those services, best known first; rewatches come
 * from your watch log, using the daily availability check.
 */
export async function pickOnServices(c: ServiceCriteria, count = 4): Promise<{ total: number; picks: ServicePick[]; checking: boolean }> {
  const providerIds = await subscribedIds();
  if (!providerIds.length) return { total: 0, picks: [], checking: false };
  const exclude = new Set(c.exclude ?? []);

  let ids: number[] = [];
  let total = 0;
  let fromTmdb = new Map<number, TmdbSearchResult>();
  let checking = false;
  const subscribed = new Set(providerIds);
  // Which of your services a film is on, in a subscription or free (rent/buy doesn't count).
  const yoursOn = (w: FilmAvailability | null) => w
    ? [...new Map([...w.stream, ...w.free, ...w.ads].filter((o) => subscribed.has(o.providerId)).map((o) => [o.providerId, o.name])).values()]
    : [];
  const servicesById = new Map<number, string[]>();
  if (c.mode === "rewatch") {
    const r = await db.execute<{ tmdb_id: number; total: number }>(sql`
      with log as (
        select w.tmdb_id, max(w.release_year) as year, max(w.watched_on) as last_watched from watches w where w.tmdb_id is not null group by w.tmdb_id)
      select l.tmdb_id, count(*) over ()::int as total
      from log l join film_availability a on a.tmdb_id = l.tmdb_id
      where exists (
          select 1 from jsonb_array_elements(coalesce(a.offers->'stream', '[]') || coalesce(a.offers->'free', '[]') || coalesce(a.offers->'ads', '[]')) o
          where (o->>'providerId')::int in ${providerIds})
        ${c.decade !== undefined ? sql`and l.year / 10 * 10 = ${c.decade}` : sql``}
        ${c.notSeenYears ? sql`and l.last_watched < current_date - make_interval(years => ${c.notSeenYears})` : sql``}
        ${exclude.size ? sql`and l.tmdb_id not in ${[...exclude]}` : sql``}
      order by random() limit ${count}`);
    ids = r.rows.map((x) => x.tmdb_id);
    total = r.rows[0]?.total ?? 0;
    const [{ n }] = (await db.execute<{ n: number }>(sql`
      select count(distinct w.tmdb_id)::int as n from watches w left join film_availability a on a.tmdb_id = w.tmdb_id
      where w.tmdb_id is not null and a.tmdb_id is null`)).rows;
    checking = n > 0;
  } else {
    const seen = c.mode === "unwatched"
      ? new Set((await db.execute<{ tmdb_id: number }>(sql`
          select tmdb_id from watches where tmdb_id is not null
          union select tmdb_id from items where tmdb_id is not null and watched_before_logging
          union select tmdb_id from seen_films where tmdb_id is not null`)).rows.map((x) => x.tmdb_id))
      : new Set<number>();
    // A random page from the 25 best-known (500 films), topped up if most of it is already watched.
    const first = await discoverOnServices({ providerIds, decade: c.decade });
    total = first.totalResults;
    const pages = Math.max(1, Math.min(first.totalPages, 25));
    const pool: TmdbSearchResult[] = [];
    for (let attempt = 0; attempt < 4 && pool.length < count * 4; attempt++) {
      const page = 1 + Math.floor(Math.random() * pages);
      const res = page === 1 ? first : await discoverOnServices({ providerIds, decade: c.decade, page });
      for (const m of res.results) if (!seen.has(m.tmdbId) && !exclude.has(m.tmdbId) && !pool.some((p) => p.tmdbId === m.tmdbId)) pool.push(m);
    }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    // TMDB's discover matches "one of your services" and "streaming or free" separately, so a film
    // you could only rent from a ticked store, streaming elsewhere, gets through. Check each one.
    const chosen: TmdbSearchResult[] = [];
    for (let i = 0; i < pool.length && chosen.length < count; i += 6) {
      const batch = await Promise.all(pool.slice(i, i + 6).map(async (m) => ({ m, on: yoursOn(await availabilityFor(m.tmdbId)) })));
      for (const { m, on } of batch) {
        if (on.length && chosen.length < count) {
          chosen.push(m);
          servicesById.set(m.tmdbId, on);
        }
      }
    }
    ids = chosen.map((m) => m.tmdbId);
    fromTmdb = new Map(chosen.map((m) => [m.tmdbId, m]));
  }
  if (!ids.length) return { total, picks: [], checking };

  // Your titles, watch counts and copies for the chosen films.
  const mine = new Map((await db.execute<{
    tmdb_id: number; title: string | null; year: number | null; times: number; last_watched: string | null;
    item_id: string | null; location: string | null; poster_path: string | null;
  }>(sql`
    select f.tmdb_id, coalesce(own.title, lw.title, fl.title) as title, coalesce(own.release_year, lw.release_year) as year,
      (select count(*) from watches w where w.tmdb_id = f.tmdb_id)::int as times,
      (select max(w.watched_on) from watches w where w.tmdb_id = f.tmdb_id)::text as last_watched,
      own.id as item_id, own.location::text as location, fl.poster_path
    from unnest(${sql.raw(`array[${ids.join(",")}]::int[]`)}) as f(tmdb_id)
    left join films fl on fl.tmdb_id = f.tmdb_id
    left join lateral (select w.title, w.release_year from watches w where w.tmdb_id = f.tmdb_id order by w.watched_on desc limit 1) lw on true
    left join lateral (
      select i.id, i.title, i.release_year, p.location from items i join products p on p.id = i.product_id
      where i.tmdb_id = f.tmdb_id and p.location <> 'gone' order by p.location = 'shelf' desc limit 1) own on true`)).rows.map((r) => [r.tmdb_id, r]));

  const picks = await Promise.all(ids.map(async (id): Promise<ServicePick> => {
    const m = mine.get(id);
    const t = fromTmdb.get(id);
    const services = servicesById.get(id) ?? yoursOn(await availabilityFor(id));
    return {
      tmdbId: id,
      title: m?.title ?? t?.title ?? "Unknown film",
      year: m?.year ?? t?.year ?? null,
      posterPath: m?.poster_path ?? t?.posterPath ?? null,
      times: m?.times ?? 0,
      lastWatched: m?.last_watched ?? null,
      owned: m?.item_id ? { itemId: m.item_id, location: m.location! } : null,
      services,
    };
  }));
  return { total, picks, checking };
}

/** Remembers that you've seen a film before you started logging (or without logging it). */
export async function markSeen(tmdbId: number, title: string, year: number | null) {
  await db.insert(seenFilms).values({ filmKey: `tmdb:${tmdbId}`, tmdbId, title, releaseYear: year, source: "pick" }).onConflictDoNothing();
  // Seen, so off the watchlist (raw SQL: watchlist.ts imports this module).
  await db.execute(sql`delete from watchlist where film_key = ${`tmdb:${tmdbId}`}`);
}