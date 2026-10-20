import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from ".";

export type Kind = "disc" | "streaming" | "cinema" | "tv" | "download" | "other";

export type WatchStats = {
  totals: {
    watches: number; films: number; rewatches: number; disc: number; first: string | null; last: string | null;
    medianAge: number | null; avgReleaseYear: number | null; fromMemory: number;
  };
  /** Every year in the log (not just the selected one), split by kind of format. */
  perYear: { year: number; kind: Kind; n: number }[];
  decades: { decade: number; watches: number; owned: number }[];
  directors: { name: string; films: number; watches: number }[];
  actors: { name: string; films: number; watches: number }[];
  /** Women in the cast (TMDB gender); actors above are everyone else. */
  actresses: { name: string; films: number; watches: number }[];
  genres: { name: string; watches: number }[];
  rewatched: { title: string; year: number | null; times: number }[];
  shelf: { films: number; watched: number };
};

const TOP = 10;

/** Everything on the Stats page, for the whole log or one year of it. Films are counted by film_key. */
export async function watchStats(year?: number): Promise<WatchStats> {
  const inYear: SQL = year ? sql`extract(year from w.watched_on)::int = ${year}` : sql`true`;
  const run = <T>(q: SQL) => db.execute<T & Record<string, unknown>>(q).then((r) => r.rows as T[]);

  const castTop = (women: boolean) => run<WatchStats["actors"][number]>(sql`
      select p.name, count(distinct w.tmdb_id)::int as films, count(*)::int as watches
      from watches w join film_credits c on c.tmdb_id = w.tmdb_id and c.role = 'cast' join people p on p.tmdb_person_id = c.person_id
      where ${inYear} and ${women ? sql`p.gender = 1` : sql`coalesce(p.gender, 0) <> 1`}
      group by p.tmdb_person_id, p.name order by films desc, watches desc, p.name limit ${TOP}`);

  const [totals, perYear, decades, directors, actors, actresses, genres, rewatched, shelf] = await Promise.all([
    // Rewatch = any watch after a film's first, numbered over the whole log.
    run<WatchStats["totals"]>(sql`
      with numbered as (
        select w.*, f.kind, row_number() over (partition by w.film_key order by w.watched_on, w.created_at) as nth
        from watches w join viewing_formats f on f.id = w.format_id)
      select count(*)::int as watches, count(distinct w.film_key)::int as films,
        count(*) filter (where w.nth > 1)::int as rewatches, count(*) filter (where w.kind = 'disc')::int as disc,
        min(w.watched_on)::text as first, max(w.watched_on)::text as last,
        percentile_cont(0.5) within group (order by extract(year from w.watched_on) - w.release_year)::int as "medianAge",
        round(avg(w.release_year))::int as "avgReleaseYear",
        count(*) filter (where w.format_from_memory)::int as "fromMemory"
      from numbered w where ${inYear}`),
    run<WatchStats["perYear"][number]>(sql`
      select extract(year from w.watched_on)::int as year, f.kind::text as kind, count(*)::int as n
      from watches w join viewing_formats f on f.id = w.format_id group by 1, 2 order by 1 desc`),
    run<WatchStats["decades"][number]>(sql`
      with wd as (select w.release_year / 10 * 10 as decade, count(*)::int as n from watches w where w.release_year is not null and ${inYear} group by 1),
           od as (select i.release_year / 10 * 10 as decade, count(*)::int as n from items i join products p on p.id = i.product_id
                  where i.item_type = 'film' and p.location <> 'gone' and i.release_year is not null group by 1)
      select coalesce(wd.decade, od.decade) as decade, coalesce(wd.n, 0) as watches, coalesce(od.n, 0) as owned
      from wd full join od on od.decade = wd.decade order by 1`),
    run<WatchStats["directors"][number]>(sql`
      select p.name, count(distinct w.tmdb_id)::int as films, count(*)::int as watches
      from watches w join film_credits c on c.tmdb_id = w.tmdb_id and c.job = 'Director' join people p on p.tmdb_person_id = c.person_id
      where ${inYear} group by p.tmdb_person_id, p.name order by films desc, watches desc, p.name limit ${TOP}`),
    castTop(false),
    castTop(true),

    run<WatchStats["genres"][number]>(sql`
      select g as name, count(*)::int as watches
      from watches w join films f on f.tmdb_id = w.tmdb_id, unnest(f.genres) g
      where ${inYear} group by g order by watches desc limit 12`),
    run<WatchStats["rewatched"][number]>(sql`
      select (array_agg(w.title order by w.watched_on desc))[1] as title, max(w.release_year) as year, count(*)::int as times
      from watches w where ${inYear} group by w.film_key having count(*) > 1 order by times desc, max(w.watched_on) desc limit ${TOP}`),
    run<WatchStats["shelf"]>(sql`
      select count(*)::int as films, count(*) filter (where s.watched)::int as watched
      from items i join products p on p.id = i.product_id join item_watch_status s on s.item_id = i.id
      where i.item_type = 'film' and p.location = 'shelf'`),
  ]);

  return { totals: totals[0], perYear, decades, directors, actors, actresses, genres, rewatched, shelf: shelf[0] };
}
