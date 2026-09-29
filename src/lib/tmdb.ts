import "server-only";

const API = "https://api.themoviedb.org/3";
export const TMDB_IMAGE = "https://image.tmdb.org/t/p";

export type TmdbSearchResult = {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
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

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) throw new Error("TMDB_READ_TOKEN is not set");
  const url = new URL(API + path);
  for (const [k, v] of Object.entries({ language: "en-GB", ...params })) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`TMDB ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

const yearOf = (date?: string | null) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);

export async function searchMovies(query: string, year?: number): Promise<TmdbSearchResult[]> {
  const params: Record<string, string> = { query, include_adult: "false" };
  if (year) params.year = String(year);
  const data = await get<{ results: { id: number; title: string; release_date?: string; poster_path: string | null }[] }>(
    "/search/movie",
    params,
  );
  return data.results.map((r) => ({
    tmdbId: r.id,
    title: r.title,
    year: yearOf(r.release_date),
    posterPath: r.poster_path,
  }));
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
