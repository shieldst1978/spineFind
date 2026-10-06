import "server-only";

const API = "https://api.themoviedb.org/3";
export const TMDB_IMAGE = "https://image.tmdb.org/t/p";

export type TmdbSearchResult = {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  /** How many TMDB users have rated it: a good guide to how well known it is. */
  voteCount: number;
};

export type TmdbMovie = {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  originalTitle: string | null;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  directors: string[];
  genres: string[];
  posterPath: string | null;
};

export function tmdbEnabled() {
  return Boolean(process.env.TMDB_READ_TOKEN);
}

async function get<T>(path: string, params: Record<string, string> = {}, attempt = 0): Promise<T> {
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) throw new Error("TMDB_READ_TOKEN is not set");
  const url = new URL(API + path);
  for (const [k, v] of Object.entries({ language: "en-GB", ...params })) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  // TMDB asks clients to back off when busy; honour Retry-After a few times.
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait * 1000));
    return get<T>(path, params, attempt + 1);
  }
  if (!res.ok) throw new Error(`TMDB ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

const yearOf = (date?: string | null) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);

export async function searchMovies(query: string, year?: number): Promise<TmdbSearchResult[]> {
  const params: Record<string, string> = { query, include_adult: "false" };
  if (year) params.year = String(year);
  const data = await get<{ results: { id: number; title: string; release_date?: string; poster_path: string | null; vote_count?: number }[] }>(
    "/search/movie",
    params,
  );
  return data.results.map((r) => ({
    tmdbId: r.id,
    title: r.title,
    year: yearOf(r.release_date),
    posterPath: r.poster_path,
    voteCount: r.vote_count ?? 0,
  }));
}

export type TmdbTitle = { title: string; country: string | null; kind: "tmdb" | "original" | "alternative" };

/** Every title a film is known by: TMDB's UK title, the original title, and alternative titles by country. */
export async function getTitles(tmdbId: number): Promise<TmdbTitle[]> {
  const [m, alt] = await Promise.all([
    get<{ title: string; original_title: string }>(`/movie/${tmdbId}`),
    get<{ titles: { iso_3166_1: string; title: string }[] }>(`/movie/${tmdbId}/alternative_titles`),
  ]);
  return titleList(m.title, m.original_title, alt.titles);
}

function titleList(title: string, original: string | null, alternatives: { iso_3166_1: string; title: string }[]): TmdbTitle[] {
  return [
    { title, country: null, kind: "tmdb" as const },
    ...(original && original !== title ? [{ title: original, country: null, kind: "original" as const }] : []),
    ...alternatives.map((a) => ({ title: a.title, country: a.iso_3166_1 || null, kind: "alternative" as const })),
  ];
}

type ReleaseDates = { results: { iso_3166_1: string; release_dates: { certification: string; type: number; release_date: string }[] }[] };

/** First UK release: the earliest cinema release (type 3), else the earliest UK release of any kind. */
function ukRelease(rd: ReleaseDates): string | null {
  const gb = rd.results.find((r) => r.iso_3166_1 === "GB")?.release_dates ?? [];
  const earliest = (list: typeof gb) => list.map((d) => d.release_date.slice(0, 10)).sort()[0] ?? null;
  return earliest(gb.filter((d) => d.type === 3)) ?? earliest(gb);
}

/** The year a film was first released in the UK, if TMDB knows it. */
export async function getUkReleaseYear(tmdbId: number): Promise<number | null> {
  const date = ukRelease(await get<ReleaseDates>(`/movie/${tmdbId}/release_dates`));
  return date ? Number(date.slice(0, 4)) : null;
}

const KEY_CREW = new Set(["Director", "Screenplay", "Writer", "Story", "Novel", "Original Music Composer", "Director of Photography", "Editor"]);

export type TmdbMovieFull = TmdbMovie & {
  ukReleaseDate: string | null;
  overview: string | null;
  keywords: string[];
  countries: string[];
  originalLanguage: string | null;
  ukCertificate: string | null;
  collection: { id: number; name: string } | null;
  voteAverage: number | null;
  voteCount: number | null;
  /** Top 10 billed cast, then key crew. */
  credits: { personId: number; name: string; profilePath: string | null; role: "cast" | "crew"; job: string; character: string | null; billing: number | null }[];
  titles: TmdbTitle[];
};

/** Everything SpineFind stores about a film, in one request. */
export async function getMovieFull(tmdbId: number): Promise<TmdbMovieFull> {
  type Person = { id: number; name: string; profile_path: string | null };
  const m = await get<{
    id: number; imdb_id: string | null; title: string; original_title: string | null; original_language: string | null;
    release_date: string | null; runtime: number | null; overview: string | null; poster_path: string | null;
    vote_average: number | null; vote_count: number | null;
    genres: { name: string }[]; production_countries: { iso_3166_1: string }[];
    belongs_to_collection: { id: number; name: string } | null;
    credits: { cast: (Person & { character: string | null; order: number })[]; crew: (Person & { job: string })[] };
    keywords: { keywords: { name: string }[] };
    release_dates: ReleaseDates;
    alternative_titles: { titles: { iso_3166_1: string; title: string }[] };
  }>(`/movie/${tmdbId}`, { append_to_response: "credits,keywords,release_dates,alternative_titles" });

  // UK certificate: prefer the cinema release (type 3), else any UK release with one.
  const gb = m.release_dates.results.find((r) => r.iso_3166_1 === "GB")?.release_dates ?? [];
  const ukCertificate =
    gb.find((d) => d.type === 3 && d.certification)?.certification ?? gb.find((d) => d.certification)?.certification ?? null;

  const cast = m.credits.cast
    .slice()
    .sort((a, b) => a.order - b.order)
    .slice(0, 10)
    .map((c) => ({ personId: c.id, name: c.name, profilePath: c.profile_path, role: "cast" as const, job: "Actor", character: c.character || null, billing: c.order }));
  const crew = m.credits.crew
    .filter((c) => KEY_CREW.has(c.job))
    .map((c) => ({ personId: c.id, name: c.name, profilePath: c.profile_path, role: "crew" as const, job: c.job, character: null, billing: null }));

  return {
    tmdbId: m.id,
    imdbId: m.imdb_id || null,
    title: m.title,
    originalTitle: m.original_title,
    releaseDate: m.release_date || null,
    ukReleaseDate: ukRelease(m.release_dates),
    runtimeMinutes: m.runtime || null,
    directors: crew.filter((c) => c.job === "Director").map((c) => c.name),
    genres: m.genres.map((g) => g.name),
    posterPath: m.poster_path,
    overview: m.overview || null,
    keywords: m.keywords.keywords.map((k) => k.name),
    countries: m.production_countries.map((c) => c.iso_3166_1),
    originalLanguage: m.original_language,
    ukCertificate,
    collection: m.belongs_to_collection ? { id: m.belongs_to_collection.id, name: m.belongs_to_collection.name } : null,
    voteAverage: m.vote_average ?? null,
    voteCount: m.vote_count ?? null,
    credits: [...cast, ...crew],
    titles: titleList(m.title, m.original_title, m.alternative_titles.titles),
  };
}

export async function getMovie(tmdbId: number): Promise<TmdbMovie> {
  const m = await get<{
    id: number; imdb_id: string | null; title: string; original_title: string | null; release_date: string | null;
    runtime: number | null; genres: { name: string }[]; poster_path: string | null;
    credits: { crew: { job: string; name: string }[] };
  }>(`/movie/${tmdbId}`, { append_to_response: "credits" });
  return {
    tmdbId: m.id,
    imdbId: m.imdb_id || null,
    title: m.title,
    originalTitle: m.original_title,
    releaseDate: m.release_date || null,
    runtimeMinutes: m.runtime || null,
    directors: m.credits.crew.filter((c) => c.job === "Director").map((c) => c.name),
    genres: m.genres.map((g) => g.name),
    posterPath: m.poster_path,
  };
}
