import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from ".";
import { location as locationEnum, mediaFormat } from "./schema";

export type Location = (typeof locationEnum.enumValues)[number];
export type MediaFormat = (typeof mediaFormat.enumValues)[number];

export type ShelfFilters = {
  q?: string;
  colours?: string[];
  format?: MediaFormat;
  location?: Location | "all";
  watched?: "watched" | "unwatched";
};

export type ShelfItem = {
  id: string;
  number: number | null;
  title: string;
  year: number | null;
  format: MediaFormat;
  type: "film" | "tv_season" | "episode";
  watched: boolean | null;
};

export type ShelfProduct = {
  id: string;
  title: string;
  spineColours: string[];
  location: Location;
  items: ShelfItem[];
};

const LIMIT = 150;

/**
 * Boxes matching the filters. Colours must all appear on the spine; boxes
 * whose dominant (first) colour was picked come first.
 */
export async function searchShelf(f: ShelfFilters): Promise<{ products: ShelfProduct[]; total: number }> {
  const q = f.q?.trim() ?? "";
  const colours = f.colours ?? [];
  const where: SQL[] = [];

  if (f.location !== "all") where.push(sql`p.location = ${f.location ?? "shelf"}`);
  for (const c of colours) where.push(sql`${c} = any(p.spine_colours)`);
  if (f.format) {
    where.push(sql`exists (select 1 from items fi where fi.product_id = p.id and fi.format = ${f.format})`);
  }
  if (f.watched) {
    where.push(sql`exists (
      select 1 from items wi join item_watch_status ws on ws.item_id = wi.id
      where wi.product_id = p.id and ws.watched = ${f.watched === "watched"})`);
  }
  if (q) {
    const like = `%${q}%`;
    where.push(sql`(
      p.title ilike ${like}
      or word_similarity(${q}, p.title) > 0.45
      or exists (select 1 from items si where si.product_id = p.id
                 and (si.title ilike ${like} or word_similarity(${q}, si.title) > 0.45)))`);
  }

  const whereSql = where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``;
  const orderBy: SQL[] = [];
  if (colours.length) {
    // Boxes whose dominant colour was picked come first.
    orderBy.push(sql`(p.spine_colours[1] in (${sql.join(colours.map((c) => sql`${c}`), sql`, `)})) desc`);
  }
  if (q) {
    orderBy.push(sql`greatest(word_similarity(${q}, p.title),
      (select max(word_similarity(${q}, ri.title)) from items ri where ri.product_id = p.id)) desc`);
  }
  orderBy.push(sql`lower(p.title)`);

  const rows = await db.execute<{
    id: string;
    title: string;
    spine_colours: string[];
    location: Location;
    items: ShelfItem[];
    total: number;
  }>(sql`
    select p.id, p.title, p.spine_colours, p.location,
      (select json_agg(json_build_object(
          'id', i.id, 'number', i.legacy_number, 'title', i.title, 'year', i.release_year,
          'format', i.format, 'type', i.item_type, 'watched', s.watched) order by i.position)
       from items i join item_watch_status s on s.item_id = i.id
       where i.product_id = p.id) as items,
      count(*) over ()::int as total
    from products p
    ${whereSql}
    order by ${sql.join(orderBy, sql`, `)}
    limit ${LIMIT}`);

  return {
    total: rows.rows[0]?.total ?? 0,
    products: rows.rows.map((r) => ({
      id: r.id,
      title: r.title,
      spineColours: r.spine_colours,
      location: r.location,
      items: r.items ?? [],
    })),
  };
}

export type ItemDetail = {
  id: string;
  title: string;
  releaseYear: number | null;
  itemType: "film" | "tv_season" | "episode";
  format: MediaFormat;
  watchedBeforeLogging: boolean;
  matchKey: string;
  watched: boolean | null;
  box: { id: string; title: string; spineColours: string[]; location: Location };
};

export async function getItem(id: string): Promise<ItemDetail | null> {
  const r = await db.execute<{
    id: string; title: string; release_year: number | null; item_type: ItemDetail["itemType"];
    format: MediaFormat; watched_before_logging: boolean; match_key: string; watched: boolean | null;
    box_id: string; box_title: string; spine_colours: string[]; location: Location;
  }>(sql`
    select i.id, i.title, i.release_year, i.item_type, i.format, i.watched_before_logging, i.match_key,
      s.watched, p.id as box_id, p.title as box_title, p.spine_colours, p.location
    from items i
    join products p on p.id = i.product_id
    join item_watch_status s on s.item_id = i.id
    where i.id = ${id}`);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    releaseYear: row.release_year,
    itemType: row.item_type,
    format: row.format,
    watchedBeforeLogging: row.watched_before_logging,
    matchKey: row.match_key,
    watched: row.watched,
    box: { id: row.box_id, title: row.box_title, spineColours: row.spine_colours, location: row.location },
  };
}

export type WatchRow = {
  id: string;
  title: string;
  watchedOn: string;
  format: string;
  kind: string;
  fromMemory: boolean;
  addedInApp: boolean;
};

/** Every logged watch of a film (any format), newest first. */
export async function watchesFor(matchKey: string): Promise<WatchRow[]> {
  const r = await db.execute<{
    id: string; title: string; watched_on: string; format: string; kind: string;
    format_from_memory: boolean; legacy_row: number | null;
  }>(sql`
    select w.id, w.title, w.watched_on::text as watched_on, f.name as format, f.kind,
      w.format_from_memory, w.legacy_row
    from watches w join viewing_formats f on f.id = w.format_id
    where w.match_key = ${matchKey}
    order by w.watched_on desc, w.created_at desc`);
  return r.rows.map((w) => ({
    id: w.id,
    title: w.title,
    watchedOn: w.watched_on,
    format: w.format,
    kind: w.kind,
    fromMemory: w.format_from_memory,
    addedInApp: w.legacy_row === null,
  }));
}

export async function getBox(id: string) {
  const r = await db.execute<{
    id: string; title: string; spine_colours: string[]; location: Location;
    items: { id: string; title: string; year: number | null; format: MediaFormat; watches: number }[] | null;
  }>(sql`
    select p.id, p.title, p.spine_colours, p.location,
      (select json_agg(json_build_object('id', i.id, 'title', i.title, 'year', i.release_year, 'format', i.format,
          'watches', (select count(*) from watches w where w.match_key = i.match_key)) order by i.position)
       from items i where i.product_id = p.id) as items
    from products p where p.id = ${id}`);
  const b = r.rows[0];
  if (!b) return null;
  return { id: b.id, title: b.title, spineColours: b.spine_colours, location: b.location, items: b.items ?? [] };
}

export type WatchDetail = {
  id: string;
  title: string;
  releaseYear: number | null;
  watchedOn: string;
  formatId: number;
  format: string;
  fromMemory: boolean;
  fromSpreadsheet: boolean;
  ownedItemId: string | null;
};

export async function getWatch(id: string): Promise<WatchDetail | null> {
  const r = await db.execute<{
    id: string; title: string; release_year: number | null; watched_on: string; format_id: number; format: string;
    format_from_memory: boolean; legacy_row: number | null; owned_item_id: string | null;
  }>(sql`
    select w.id, w.title, w.release_year, w.watched_on::text as watched_on, w.format_id, f.name as format,
      w.format_from_memory, w.legacy_row,
      (select i.id from items i where i.match_key = w.match_key and i.item_type = 'film' limit 1) as owned_item_id
    from watches w join viewing_formats f on f.id = w.format_id
    where w.id = ${id}`);
  const w = r.rows[0];
  if (!w) return null;
  return {
    id: w.id,
    title: w.title,
    releaseYear: w.release_year,
    watchedOn: w.watched_on,
    formatId: w.format_id,
    format: w.format,
    fromMemory: w.format_from_memory,
    fromSpreadsheet: w.legacy_row !== null,
    ownedItemId: w.owned_item_id,
  };
}

export async function listViewingFormats() {
  const r = await db.execute<{ id: number; name: string; kind: string; uses: number }>(sql`
    select f.id, f.name, f.kind, count(w.id)::int as uses
    from viewing_formats f left join watches w on w.format_id = f.id
    group by f.id order by f.kind = 'disc' desc, uses desc, f.name`);
  return r.rows;
}

export type WatchFilters = {
  q?: string;
  year?: number;
  formatId?: number;
  kind?: string;
  decade?: number;
  owned?: "yes" | "no";
  sort?: "date" | "title" | "release" | "times" | "age";
  dir?: "asc" | "desc";
  page?: number;
};

export type WatchLogRow = {
  id: string;
  title: string;
  releaseYear: number | null;
  watchedOn: string;
  format: string;
  kind: string;
  fromMemory: boolean;
  nth: number;
  times: number;
  age: number | null;
  ownedItemId: string | null;
  ownedFormat: string | null;
  addedInApp: boolean;
};

export type WatchSummary = {
  total: number;
  films: number;
  disc: number;
  cinema: number;
  rewatches: number;
  medianAge: number | null;
  topDecade: number | null;
  topDecadeShare: number | null;
  first: string | null;
  last: string | null;
};

export const WATCH_PAGE_SIZE = 100;

/** The watch log with derived columns, filtered, sorted and paged, plus a summary of the filtered set. */
export async function searchWatches(f: WatchFilters) {
  const where: SQL[] = [];
  const q = f.q?.trim();
  if (q) where.push(sql`(title ilike ${`%${q}%`} or word_similarity(${q}, title) > 0.5)`);
  if (f.year) where.push(sql`extract(year from watched_on)::int = ${f.year}`);
  if (f.formatId) where.push(sql`format_id = ${f.formatId}`);
  if (f.kind) where.push(sql`kind = ${f.kind}`);
  if (f.decade !== undefined) where.push(sql`release_year / 10 * 10 = ${f.decade}`);
  if (f.owned === "yes") where.push(sql`owned_item_id is not null`);
  if (f.owned === "no") where.push(sql`owned_item_id is null`);
  const whereSql = where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``;

  const dir = f.dir === "asc" ? sql`asc` : sql`desc`;
  const sortCol = {
    date: sql`watched_on`,
    title: sql`lower(title)`,
    release: sql`release_year`,
    times: sql`times`,
    age: sql`age`,
  }[f.sort ?? "date"];
  const page = Math.max(1, f.page ?? 1);

  // Rewatch numbering is over the whole log, so filters don't renumber it.
  const log = sql`
    with log as (
      select w.id, w.title, w.release_year, w.watched_on, w.format_id, w.format_from_memory, w.created_at, w.legacy_row,
        f.name as format, f.kind::text as kind,
        row_number() over (partition by w.match_key order by w.watched_on, w.created_at)::int as nth,
        count(*) over (partition by w.match_key)::int as times,
        extract(year from w.watched_on)::int - w.release_year as age,
        own.id as owned_item_id, own.format::text as owned_format
      from watches w
      join viewing_formats f on f.id = w.format_id
      left join lateral (
        select i.id, i.format from items i join products p on p.id = i.product_id
        where i.match_key = w.match_key and i.item_type = 'film'
        order by (p.location = 'shelf') desc, i.format limit 1
      ) own on true
    )`;

  const [rows, summary] = await Promise.all([
    db.execute<{
      id: string; title: string; release_year: number | null; watched_on: string; format: string; kind: string;
      format_from_memory: boolean; nth: number; times: number; age: number | null;
      owned_item_id: string | null; owned_format: string | null; legacy_row: number | null;
    }>(sql`${log}
      select id, title, release_year, watched_on::text as watched_on, format, kind, format_from_memory,
        nth, times, age, owned_item_id, owned_format, legacy_row
      from log ${whereSql}
      order by ${sortCol} ${dir} nulls last, watched_on desc, created_at desc
      limit ${WATCH_PAGE_SIZE} offset ${(page - 1) * WATCH_PAGE_SIZE}`),
    db.execute<{
      total: number; films: number; disc: number; cinema: number; rewatches: number;
      median_age: number | null; top_decade: number | null; top_decade_n: number | null;
      with_year: number; first: string | null; last: string | null;
    }>(sql`${log}, sel as (select * from log ${whereSql}),
      dec as (select release_year / 10 * 10 as decade, count(*)::int as n from sel
              where release_year is not null group by 1 order by n desc, decade desc limit 1)
      select count(*)::int as total,
        count(distinct lower(title) || '|' || coalesce(release_year::text, ''))::int as films,
        count(*) filter (where kind = 'disc')::int as disc,
        count(*) filter (where kind = 'cinema')::int as cinema,
        count(*) filter (where nth > 1)::int as rewatches,
        (percentile_cont(0.5) within group (order by age))::int as median_age,
        (select decade from dec) as top_decade,
        (select n from dec) as top_decade_n,
        count(release_year)::int as with_year,
        min(watched_on)::text as first, max(watched_on)::text as last
      from sel`),
  ]);

  const s = summary.rows[0];
  return {
    rows: rows.rows.map<WatchLogRow>((r) => ({
      id: r.id,
      title: r.title,
      releaseYear: r.release_year,
      watchedOn: r.watched_on,
      format: r.format,
      kind: r.kind,
      fromMemory: r.format_from_memory,
      nth: r.nth,
      times: r.times,
      age: r.age,
      ownedItemId: r.owned_item_id,
      ownedFormat: r.owned_format,
      addedInApp: r.legacy_row === null,
    })),
    summary: {
      total: s.total,
      films: s.films,
      disc: s.disc,
      cinema: s.cinema,
      rewatches: s.rewatches,
      medianAge: s.median_age,
      topDecade: s.top_decade,
      topDecadeShare: s.top_decade_n && s.with_year ? s.top_decade_n / s.with_year : null,
      first: s.first,
      last: s.last,
    } satisfies WatchSummary,
    page,
    pages: Math.max(1, Math.ceil(s.total / WATCH_PAGE_SIZE)),
  };
}

export async function watchYears() {
  const r = await db.execute<{ year: number; n: number }>(sql`
    select extract(year from watched_on)::int as year, count(*)::int as n
    from watches group by 1 order by 1 desc`);
  return r.rows;
}

export type PickCriteria = {
  mode: "unwatched" | "rewatch" | "any";
  format?: MediaFormat;
  decade?: number;
  colour?: string;
  notSeenYears?: number;
  exclude?: string[];
};

export type PickCandidate = {
  id: string;
  title: string;
  year: number | null;
  format: MediaFormat;
  box: string;
  spineColours: string[];
  watched: boolean;
  lastWatched: string | null;
  times: number;
};

function pickWhere(c: Omit<PickCriteria, "decade" | "exclude">): SQL[] {
  const where: SQL[] = [sql`i.item_type = 'film'`, sql`p.location = 'shelf'`];
  if (c.mode === "unwatched") where.push(sql`not s.watched`);
  if (c.mode === "rewatch") where.push(sql`s.watched`);
  if (c.format) where.push(sql`i.format = ${c.format}`);
  if (c.colour) where.push(sql`${c.colour} = any(p.spine_colours)`);
  return where;
}

/** Decades with at least one shelf film matching the other criteria, newest first, with counts. */
export async function pickDecades(c: Omit<PickCriteria, "decade" | "exclude">) {
  const r = await db.execute<{ decade: number; n: number }>(sql`
    select i.release_year / 10 * 10 as decade, count(*)::int as n
    from items i
    join products p on p.id = i.product_id
    join item_watch_status s on s.item_id = i.id
    where ${sql.join(pickWhere(c), sql` and `)} and i.release_year is not null
    group by 1 order by 1 desc`);
  return r.rows;
}

/** Release decades that appear in the watch log, newest first, with counts. */
export async function watchDecades() {
  const r = await db.execute<{ decade: number; n: number }>(sql`
    select release_year / 10 * 10 as decade, count(*)::int as n
    from watches where release_year is not null
    group by 1 order by 1 desc`);
  return r.rows;
}

/** A random release decade that has at least one film matching the other criteria. */
export async function randomDecade(c: Omit<PickCriteria, "decade" | "exclude">): Promise<number | null> {
  // Each decade with a match is equally likely, however many films it has.
  const r = await db.execute<{ decade: number }>(sql`
    select decade from (
      select distinct i.release_year / 10 * 10 as decade
      from items i
      join products p on p.id = i.product_id
      join item_watch_status s on s.item_id = i.id
      where ${sql.join(pickWhere(c), sql` and `)} and i.release_year is not null
    ) d
    order by random() limit 1`);
  return r.rows[0]?.decade ?? null;
}

/** Random films from the shelf matching the criteria: the pick plus a few runners-up. */
export async function pickFilms(c: PickCriteria, count = 4) {
  const where = pickWhere(c);
  if (c.decade !== undefined) where.push(sql`i.release_year / 10 * 10 = ${c.decade}`);

  const rows = await db.execute<{
    id: string; title: string; year: number | null; format: MediaFormat; box: string; spine_colours: string[];
    watched: boolean; last_watched: string | null; times: number; total: number;
  }>(sql`
    with cand as (
      select i.id, i.title, i.release_year as year, i.format, p.title as box, p.spine_colours, s.watched,
        (select max(w.watched_on) from watches w where w.match_key = i.match_key)::text as last_watched,
        (select count(*) from watches w where w.match_key = i.match_key)::int as times
      from items i
      join products p on p.id = i.product_id
      join item_watch_status s on s.item_id = i.id
      where ${sql.join(where, sql` and `)}
    )
    select *, count(*) over ()::int as total from cand
    where true
      ${c.notSeenYears ? sql`and (last_watched is null or last_watched::date < current_date - make_interval(years => ${c.notSeenYears}))` : sql``}
      ${c.exclude?.length ? sql`and id::text not in (${sql.join(c.exclude.map((x) => sql`${x}`), sql`, `)})` : sql``}
    order by random()
    limit ${count}`);

  return {
    total: rows.rows[0]?.total ?? 0,
    picks: rows.rows.map<PickCandidate>((r) => ({
      id: r.id,
      title: r.title,
      year: r.year,
      format: r.format,
      box: r.box,
      spineColours: r.spine_colours,
      watched: r.watched,
      lastWatched: r.last_watched,
      times: r.times,
    })),
  };
}

export async function shelfTotals() {
  const r = await db.execute<{ products: number; films: number; watched: number }>(sql`
    select
      (select count(*) from products where location = 'shelf')::int as products,
      (select count(*) from items i join products p on p.id = i.product_id
        where p.location = 'shelf' and i.item_type = 'film')::int as films,
      (select count(*) from item_watch_status s join items i on i.id = s.item_id
        join products p on p.id = i.product_id where p.location = 'shelf' and s.watched)::int as watched`);
  return r.rows[0];
}
