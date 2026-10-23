import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from ".";
import { tvEpisodes, tvSeasons, tvShows, tvWatches } from "./schema";
import { getTvSeason, getTvShow, tmdbEnabled } from "@/lib/tmdb";

const SHOW_MAX_AGE_DAYS = 7;
/** Episode lists for seasons still airing change (new episodes, titles); finished ones rarely do. */
const SEASON_MAX_AGE_DAYS = 3;

/** Fetches a show (details and its list of seasons) from TMDB if it's new or a week old. */
export async function ensureShow(tmdbTvId: number) {
  const [have] = await db.select({ at: tvShows.fetchedAt }).from(tvShows).where(eq(tvShows.tmdbTvId, tmdbTvId));
  if (have && Date.now() - have.at.getTime() < SHOW_MAX_AGE_DAYS * 864e5) return;
  if (!tmdbEnabled()) return;
  try {
    const s = await getTvShow(tmdbTvId);
    const values = {
      name: s.name, originalName: s.originalName, firstAirDate: s.firstAirDate, lastAirDate: s.lastAirDate, status: s.status,
      numberOfSeasons: s.numberOfSeasons, numberOfEpisodes: s.numberOfEpisodes, genres: s.genres, networks: s.networks,
      creators: s.creators, posterPath: s.posterPath, overview: s.overview, voteAverage: s.voteAverage, fetchedAt: new Date(),
    };
    await db.transaction(async (tx) => {
      await tx.insert(tvShows).values({ tmdbTvId, ...values }).onConflictDoUpdate({ target: tvShows.tmdbTvId, set: values });
      for (const se of s.seasons) {
        const v = { name: se.name, airDate: se.airDate, episodeCount: se.episodeCount, posterPath: se.posterPath };
        await tx.insert(tvSeasons).values({ tmdbTvId, seasonNumber: se.seasonNumber, ...v })
          .onConflictDoUpdate({ target: [tvSeasons.tmdbTvId, tvSeasons.seasonNumber], set: v });
      }
    });
  } catch (e) {
    if (!have) throw e; // no copy to fall back on
    console.error("TMDB TV show refresh failed", tmdbTvId, (e as Error).message);
  }
}

/** Fetches a season's episodes if not yet fetched, or stale. */
export async function ensureSeason(tmdbTvId: number, seasonNumber: number) {
  const [se] = await db.select().from(tvSeasons).where(and(eq(tvSeasons.tmdbTvId, tmdbTvId), eq(tvSeasons.seasonNumber, seasonNumber)));
  if (!se) return;
  if (se.episodesFetchedAt && Date.now() - se.episodesFetchedAt.getTime() < SEASON_MAX_AGE_DAYS * 864e5) return;
  if (!tmdbEnabled()) return;
  try {
    const eps = await getTvSeason(tmdbTvId, seasonNumber);
    await db.transaction(async (tx) => {
      for (const e of eps) {
        const v = { name: e.name, airDate: e.airDate, runtime: e.runtime, tmdbEpisodeId: e.tmdbEpisodeId };
        await tx.insert(tvEpisodes).values({ tmdbTvId, seasonNumber, episodeNumber: e.episodeNumber, ...v })
          .onConflictDoUpdate({ target: [tvEpisodes.tmdbTvId, tvEpisodes.seasonNumber, tvEpisodes.episodeNumber], set: v });
      }
      await tx.update(tvSeasons).set({ episodesFetchedAt: new Date(), episodeCount: eps.length })
        .where(and(eq(tvSeasons.tmdbTvId, tmdbTvId), eq(tvSeasons.seasonNumber, seasonNumber)));
    });
  } catch (e) {
    if (!se.episodesFetchedAt) throw e;
    console.error("TMDB TV season refresh failed", tmdbTvId, seasonNumber, (e as Error).message);
  }
}

export type EpisodeRow = { episodeNumber: number; name: string | null; airDate: string | null; runtime: number | null; times: number; lastWatched: string | null };
export type SeasonRow = { seasonNumber: number; name: string | null; airDate: string | null; episodeCount: number; watched: number; episodes: EpisodeRow[] | null };
export type ShowPage = {
  show: typeof tvShows.$inferSelect;
  seasons: SeasonRow[];
  /** The next episode to watch: after the most recently watched one (by date logged), else the first. */
  next: { seasonNumber: number; episodeNumber: number; name: string | null } | null;
  lastFormatId: number | null;
  watchedEpisodes: number;
  totalEpisodes: number;
};

/**
 * A show with every season, your progress, and the next episode. Episode lists are fetched for the seasons
 * you've started plus the next one; `openSeason` fetches one more on demand.
 */
export async function showPage(tmdbTvId: number, openSeason?: number): Promise<ShowPage | null> {
  await ensureShow(tmdbTvId);
  const [show] = await db.select().from(tvShows).where(eq(tvShows.tmdbTvId, tmdbTvId));
  if (!show) return null;
  const seasons = await db.select().from(tvSeasons).where(eq(tvSeasons.tmdbTvId, tmdbTvId)).orderBy(asc(tvSeasons.seasonNumber));
  const watchedSeasons = new Set((await db.execute<{ s: number }>(sql`select distinct season_number as s from tv_watches where tmdb_tv_id = ${tmdbTvId}`)).rows.map((r) => r.s));
  // Seasons worth having episodes for: started ones, the first regular season, the one after the latest started, and any asked for.
  const regular = seasons.filter((s) => s.seasonNumber > 0).map((s) => s.seasonNumber);
  const latest = Math.max(0, ...[...watchedSeasons]);
  const wanted = new Set<number>([...watchedSeasons, regular[0] ?? 1, regular.find((n) => n > latest) ?? -1, ...(openSeason !== undefined ? [openSeason] : [])]);
  await Promise.all([...wanted].filter((n) => seasons.some((s) => s.seasonNumber === n)).map((n) => ensureSeason(tmdbTvId, n)));

  const eps = await db.execute<{ season_number: number; episode_number: number; name: string | null; air_date: string | null; runtime: number | null; times: number; last_watched: string | null }>(sql`
    select e.season_number, e.episode_number, e.name, e.air_date::text as air_date, e.runtime,
      count(w.id)::int as times, max(w.watched_on)::text as last_watched
    from tv_episodes e left join tv_watches w on w.tmdb_tv_id = e.tmdb_tv_id and w.season_number = e.season_number and w.episode_number = e.episode_number
    where e.tmdb_tv_id = ${tmdbTvId}
    group by e.season_number, e.episode_number, e.name, e.air_date, e.runtime order by 1, 2`);
  const fetched = new Map<number, EpisodeRow[]>();
  for (const e of eps.rows) {
    const list = fetched.get(e.season_number) ?? [];
    list.push({ episodeNumber: e.episode_number, name: e.name, airDate: e.air_date, runtime: e.runtime, times: e.times, lastWatched: e.last_watched });
    fetched.set(e.season_number, list);
  }
  const counts = new Map((await db.execute<{ s: number; n: number }>(sql`
    select season_number as s, count(distinct episode_number)::int as n from tv_watches where tmdb_tv_id = ${tmdbTvId} group by 1`)).rows.map((r) => [r.s, r.n]));
  const rows: SeasonRow[] = seasons.map((s) => ({
    seasonNumber: s.seasonNumber, name: s.name, airDate: s.airDate, episodeCount: s.episodeCount ?? fetched.get(s.seasonNumber)?.length ?? 0,
    watched: counts.get(s.seasonNumber) ?? 0, episodes: fetched.get(s.seasonNumber) ?? null,
  }));

  // Next episode: the one after your most recently logged; when that ends a season, the next season's first.
  const [last] = (await db.execute<{ season_number: number; episode_number: number; format_id: number }>(sql`
    select season_number, episode_number, format_id from tv_watches where tmdb_tv_id = ${tmdbTvId}
    order by watched_on desc, created_at desc, season_number desc, episode_number desc limit 1`)).rows;
  const ordered = rows.filter((s) => s.seasonNumber > 0).flatMap((s) => (s.episodes ?? []).map((e) => ({ seasonNumber: s.seasonNumber, ...e })));
  let next: ShowPage["next"] = null;
  if (ordered.length) {
    const i = last ? ordered.findIndex((e) => e.seasonNumber === last.season_number && e.episodeNumber === last.episode_number) : -1;
    const candidate = last ? (i >= 0 ? ordered[i + 1] : undefined) : ordered[0];
    if (candidate) next = { seasonNumber: candidate.seasonNumber, episodeNumber: candidate.episodeNumber, name: candidate.name };
  }
  const totalEpisodes = rows.filter((s) => s.seasonNumber > 0).reduce((a, s) => a + s.episodeCount, 0);
  const watchedEpisodes = rows.filter((s) => s.seasonNumber > 0).reduce((a, s) => a + s.watched, 0);
  return { show, seasons: rows, next, lastFormatId: last?.format_id ?? null, watchedEpisodes, totalEpisodes };
}

/** Logs episodes of a show (one row each). For a whole season, pass all its episode numbers. */
export async function logEpisodes(o: { tmdbTvId: number; seasonNumber: number; episodes: number[]; watchedOn: string; formatId: number; fromMemory: boolean }) {
  if (!o.episodes.length) return 0;
  await db.insert(tvWatches).values(o.episodes.map((episodeNumber) => ({
    tmdbTvId: o.tmdbTvId, seasonNumber: o.seasonNumber, episodeNumber, watchedOn: o.watchedOn, formatId: o.formatId, fromMemory: o.fromMemory,
  })));
  return o.episodes.length;
}

/** Shows you're watching: most recently watched first, with progress and what's next. */
export async function recentShows(limit = 12) {
  const r = await db.execute<{
    tmdb_tv_id: number; name: string; poster_path: string | null; last_watched: string; episodes_watched: number; total: number | null; status: string | null;
  }>(sql`
    select s.tmdb_tv_id, s.name, s.poster_path, max(w.watched_on)::text as last_watched,
      count(distinct (w.season_number, w.episode_number)) filter (where w.season_number > 0)::int as episodes_watched,
      s.number_of_episodes as total, s.status
    from tv_watches w join tv_shows s on s.tmdb_tv_id = w.tmdb_tv_id
    group by s.tmdb_tv_id order by max(w.created_at) desc limit ${limit}`);
  return r.rows;
}

export type TvLogRow = { id: string; tmdbTvId: number; show: string; season: number; episode: number; episodeName: string | null; watchedOn: string; format: string; fromMemory: boolean; nth: number };
export const TV_LOG_PAGE = 100;

/** The TV watch log, newest first, with rewatch numbering per episode. */
export async function tvLog(page = 1): Promise<{ rows: TvLogRow[]; total: number }> {
  const r = await db.execute<{
    id: string; tmdb_tv_id: number; show: string; season_number: number; episode_number: number; episode_name: string | null;
    watched_on: string; format: string; from_memory: boolean; nth: number; total: number;
  }>(sql`
    with log as (
      select w.*, row_number() over (partition by w.tmdb_tv_id, w.season_number, w.episode_number order by w.watched_on, w.created_at)::int as nth
      from tv_watches w)
    select l.id, l.tmdb_tv_id, s.name as show, l.season_number, l.episode_number, e.name as episode_name, l.watched_on::text as watched_on,
      f.name as format, l.from_memory, l.nth, count(*) over ()::int as total
    from log l join tv_shows s on s.tmdb_tv_id = l.tmdb_tv_id join viewing_formats f on f.id = l.format_id
    left join tv_episodes e on e.tmdb_tv_id = l.tmdb_tv_id and e.season_number = l.season_number and e.episode_number = l.episode_number
    order by l.watched_on desc, l.created_at desc, l.season_number desc, l.episode_number desc
    limit ${TV_LOG_PAGE} offset ${(Math.max(1, page) - 1) * TV_LOG_PAGE}`);
  return {
    total: r.rows[0]?.total ?? 0,
    rows: r.rows.map((x) => ({ id: x.id, tmdbTvId: x.tmdb_tv_id, show: x.show, season: x.season_number, episode: x.episode_number, episodeName: x.episode_name, watchedOn: x.watched_on, format: x.format, fromMemory: x.from_memory, nth: x.nth })),
  };
}

export async function deleteTvWatch(id: string) {
  await db.delete(tvWatches).where(eq(tvWatches.id, id));
}
