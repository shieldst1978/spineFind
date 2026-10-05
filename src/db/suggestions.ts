import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from ".";
import { matchKey, normaliseTitle } from "@/lib/match-key";
import { searchMovies, tmdbEnabled } from "@/lib/tmdb";

export type FilmSuggestion = {
  title: string;
  year: number | null;
  owned: boolean;
  /** Format of the best copy you own (shelf before loft, 4K before Blu-ray before DVD). */
  ownedFormat: string | null;
  watches: number;
  tmdbId: number | null;
  posterPath: string | null;
  source: "yours" | "tmdb";
};

/**
 * Films matching what's been typed: your own log and shelf first, then TMDB.
 * A TMDB result for a film you already have (same title + year) is merged
 * into your entry rather than listed twice.
 */
export async function findFilmSuggestions(query: string): Promise<FilmSuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  // Short titles (X, M, It, Up) are real films: TMDB searches from one letter
  // and ranks exact matches first; your own films only match exactly.
  const [yours, tmdb] = await Promise.all([
    q.length < 3 ? exactLocalSuggestions(q) : localSuggestions(q),
    tmdbEnabled() ? searchMovies(q).catch(() => []) : Promise.resolve([]),
  ]);
  const byKey = new Map(yours.map((s) => [matchKey(s.title, s.year), s]));
  const extra: FilmSuggestion[] = [];
  for (const t of tmdb.slice(0, 8)) {
    const mine = byKey.get(matchKey(t.title, t.year));
    if (mine) {
      mine.tmdbId ??= t.tmdbId;
      mine.posterPath ??= t.posterPath;
    } else {
      extra.push({ title: t.title, year: t.year, owned: false, ownedFormat: null, watches: 0, tmdbId: t.tmdbId, posterPath: t.posterPath, source: "tmdb" });
    }
  }
  // Order: exact title matches (wherever from), then yours that contain the
  // typed text, then TMDB's, then yours that only matched loosely (typos).
  const exact = normaliseTitle(q);
  const rank = (s: FilmSuggestion) =>
    normaliseTitle(s.title) === exact ? 0 : s.source === "tmdb" ? 2 : normaliseTitle(s.title).includes(exact) ? 1 : 3;
  return [...yours, ...extra]
    .map((s, i) => ({ s, i, r: rank(s) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.s)
    .slice(0, 10);
}

/** Your own films whose title is exactly what's been typed (any year). */
function exactLocalSuggestions(q: string) {
  return localSuggestions(q, sql`match_key like ${`${normaliseTitle(q)}|%`}`);
}

async function localSuggestions(q: string, match?: SQL): Promise<FilmSuggestion[]> {
  const r = await db.execute<{
    title: string; year: number | null; owned: boolean; owned_format: string | null; watches: number; tmdb_id: number | null; poster_path: string | null;
  }>(sql`
    with mine as (
      select title, release_year, match_key, tmdb_id, false as owned, null::text as format, null::int as pref from watches
      union all
      -- Copies you still have (not "gone"); pref ranks shelf before loft, then 4K > Blu-ray > HD DVD > DVD.
      select i.title, i.release_year, i.match_key, i.tmdb_id, true, i.format::text,
        (case p.location when 'shelf' then 0 else 10 end)
          + (case i.format when '4K UltraHD' then 0 when 'Blu Ray' then 1 when 'HD DVD' then 2 else 3 end)
      from items i join products p on p.id = i.product_id
      where i.item_type = 'film' and p.location <> 'gone'
    ),
    grouped as (
      select (array_agg(title order by owned desc, title))[1] as title, release_year as year,
        bool_or(owned) as owned, (array_agg(format order by pref) filter (where owned))[1] as owned_format,
        count(*) filter (where not owned)::int as watches,
        max(tmdb_id) as tmdb_id, bool_or(title ilike ${`${q}%`}) as prefix
      from mine
      where ${match ?? sql`(title ilike ${`%${q}%`} or word_similarity(${q}, title) > 0.6)`}
      group by match_key, release_year
    )
    select g.title, g.year, g.owned, g.owned_format, g.watches, g.tmdb_id, f.poster_path
    from grouped g left join films f on f.tmdb_id = g.tmdb_id
    order by g.prefix desc, word_similarity(${q}, g.title) desc, g.watches desc
    limit 6`);
  return r.rows.map((s) => ({
    title: s.title,
    year: s.year,
    owned: s.owned,
    ownedFormat: s.owned_format,
    watches: s.watches,
    tmdbId: s.tmdb_id,
    posterPath: s.poster_path,
    source: "yours",
  }));
}
