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
  /** TMDB users' average score, 0-10. */
  voteAverage: number | null;
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
  const data = await get<{ results: { id: number; title: string; release_date?: string; poster_path: string | null; vote_count?: number; vote_average?: number }[] }>(
    "/search/movie",
    params,
  );
  return data.results.map((r) => ({
    tmdbId: r.id,
    title: r.title,
    year: yearOf(r.release_date),
    posterPath: r.poster_path,
    voteCount: r.vote_count ?? 0,
    voteAverage: r.vote_average ?? null,
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
  credits: { personId: number; name: string; profilePath: string | null; gender: number | null; role: "cast" | "crew"; job: string; character: string | null; billing: number | null }[];
  titles: TmdbTitle[];
};

/** Everything SpineFind stores about a film, in one request. */
export async function getMovieFull(tmdbId: number): Promise<TmdbMovieFull> {
  /** gender: TMDB's code, 0 not set, 1 female, 2 male, 3 non-binary. */
  type Person = { id: number; name: string; profile_path: string | null; gender?: number };
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
    .map((c) => ({ personId: c.id, name: c.name, profilePath: c.profile_path, gender: c.gender || null, role: "cast" as const, job: "Actor", character: c.character || null, billing: c.order }));
  const crew = m.credits.crew
    .filter((c) => KEY_CREW.has(c.job))
    .map((c) => ({ personId: c.id, name: c.name, profilePath: c.profile_path, gender: c.gender || null, role: "crew" as const, job: c.job, character: null, billing: null }));

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


export type TmdbProvider = { providerId: number; name: string; logoPath: string | null; priority: number };

/** Every streaming / rental service TMDB (via JustWatch) knows in the UK, big ones first. */
export async function listUkProviders(): Promise<TmdbProvider[]> {
  const data = await get<{ results: { provider_id: number; provider_name: string; logo_path: string | null; display_priorities?: Record<string, number>; display_priority?: number }[] }>(
    "/watch/providers/movie",
    { watch_region: "GB" },
  );
  return data.results
    .map((p) => ({ providerId: p.provider_id, name: p.provider_name, logoPath: p.logo_path, priority: p.display_priorities?.GB ?? p.display_priority ?? 999 }))
    .sort((a, b) => a.priority - b.priority);
}

export type Offer = { providerId: number; name: string; logoPath: string | null };
/** How a film can be watched in the UK: in a subscription, free, free with ads, to rent or to buy. */
export type Availability = { stream: Offer[]; free: Offer[]; ads: Offer[]; rent: Offer[]; buy: Offer[] };

export async function getUkAvailability(tmdbId: number): Promise<Availability> {
  type P = { provider_id: number; provider_name: string; logo_path: string | null; display_priority: number }[];
  const data = await get<{ results: Record<string, { flatrate?: P; free?: P; ads?: P; rent?: P; buy?: P }> }>(`/movie/${tmdbId}/watch/providers`);
  const gb = data.results.GB ?? {};
  const list = (p?: P) => [...(p ?? [])].sort((a, b) => a.display_priority - b.display_priority)
    .map((x) => ({ providerId: x.provider_id, name: x.provider_name, logoPath: x.logo_path }));
  return { stream: list(gb.flatrate), free: list(gb.free), ads: list(gb.ads), rent: list(gb.rent), buy: list(gb.buy) };
}

/**
 * Films streaming (in a subscription, or free) on any of the given UK services, best known first.
 * Optionally limited to a release decade. TMDB serves up to 500 pages of 20.
 */
export async function discoverOnServices(o: {
  providerIds: number[]; decade?: number; page?: number; genreId?: number; maxRuntime?: number; sort?: "popularity" | "rating"; minVotes?: number; maxVotes?: number;
}): Promise<{ results: TmdbSearchResult[]; totalPages: number; totalResults: number }> {
  const params: Record<string, string> = {
    watch_region: "GB",
    with_watch_providers: o.providerIds.join("|"),
    with_watch_monetization_types: "flatrate|free|ads",
    sort_by: o.sort === "rating" ? "vote_average.desc" : "popularity.desc",
    "vote_count.gte": String(o.minVotes ?? 200),
    include_adult: "false",
    page: String(o.page ?? 1),
  };
  if (o.maxVotes) params["vote_count.lte"] = String(o.maxVotes);
  if (o.genreId) params.with_genres = String(o.genreId);
  if (o.maxRuntime) params["with_runtime.lte"] = String(o.maxRuntime);
  if (o.decade !== undefined) {
    params["primary_release_date.gte"] = `${o.decade}-01-01`;
    params["primary_release_date.lte"] = `${o.decade + 9}-12-31`;
  }
  const data = await get<{ results: { id: number; title: string; release_date?: string; poster_path: string | null; vote_count?: number; vote_average?: number }[]; total_pages: number; total_results: number }>(
    "/discover/movie",
    params,
  );
  return {
    results: data.results.map((r) => ({ tmdbId: r.id, title: r.title, year: yearOf(r.release_date), posterPath: r.poster_path, voteCount: r.vote_count ?? 0, voteAverage: r.vote_average ?? null })),
    totalPages: Math.min(data.total_pages, 500),
    totalResults: data.total_results,
  };
}

/** TMDB's fixed movie genre ids, by the names used in film records. */
export const TMDB_GENRES: Record<string, number> = {
  action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, documentary: 99, drama: 18, family: 10751,
  fantasy: 14, history: 36, horror: 27, music: 10402, mystery: 9648, romance: 10749, "science fiction": 878,
  "tv movie": 10770, thriller: 53, war: 10752, western: 37,
};

/** The TMDB film for an IMDb id (tt…), or null if TMDB has none (e.g. it's a TV series). */
export async function findByImdbId(imdbId: string): Promise<number | null> {
  const data = await get<{ movie_results?: { id: number }[] }>(`/find/${imdbId}`, { external_source: "imdb_id" });
  return data.movie_results?.[0]?.id ?? null;
}

/** Everyone credited on a film with TMDB's gender code (0 not set, 1 female, 2 male, 3 non-binary). */
export async function getCreditGenders(tmdbId: number): Promise<{ personId: number; gender: number }[]> {
  type P = { id: number; gender?: number };
  const data = await get<{ cast: P[]; crew: P[] }>(`/movie/${tmdbId}/credits`);
  return [...data.cast, ...data.crew].filter((p) => p.gender).map((p) => ({ personId: p.id, gender: p.gender! }));
}

// ---- TV

export type TvSearchResult = { tmdbTvId: number; name: string; year: number | null; posterPath: string | null; voteCount: number };

export async function searchTv(query: string): Promise<TvSearchResult[]> {
  const data = await get<{ results: { id: number; name: string; first_air_date?: string; poster_path: string | null; vote_count?: number }[] }>(
    "/search/tv", { query, include_adult: "false" },
  );
  return data.results.map((r) => ({ tmdbTvId: r.id, name: r.name, year: yearOf(r.first_air_date), posterPath: r.poster_path, voteCount: r.vote_count ?? 0 }));
}

export type TvShowFull = {
  tmdbTvId: number; name: string; originalName: string | null; firstAirDate: string | null; lastAirDate: string | null;
  status: string | null; numberOfSeasons: number | null; numberOfEpisodes: number | null; genres: string[]; networks: string[];
  creators: string[]; posterPath: string | null; overview: string | null; voteAverage: number | null;
  seasons: { seasonNumber: number; name: string | null; airDate: string | null; episodeCount: number | null; posterPath: string | null }[];
};

export async function getTvShow(tmdbTvId: number): Promise<TvShowFull> {
  const m = await get<{
    id: number; name: string; original_name: string | null; first_air_date: string | null; last_air_date: string | null; status: string | null;
    number_of_seasons: number | null; number_of_episodes: number | null; genres: { name: string }[]; networks: { name: string }[];
    created_by: { name: string }[]; poster_path: string | null; overview: string | null; vote_average: number | null;
    seasons: { season_number: number; name: string | null; air_date: string | null; episode_count: number | null; poster_path: string | null }[];
  }>(`/tv/${tmdbTvId}`);
  return {
    tmdbTvId: m.id, name: m.name, originalName: m.original_name, firstAirDate: m.first_air_date || null, lastAirDate: m.last_air_date || null,
    status: m.status, numberOfSeasons: m.number_of_seasons, numberOfEpisodes: m.number_of_episodes,
    genres: m.genres.map((g) => g.name), networks: m.networks.map((n) => n.name), creators: m.created_by.map((c) => c.name),
    posterPath: m.poster_path, overview: m.overview || null, voteAverage: m.vote_average ?? null,
    seasons: m.seasons.map((s) => ({ seasonNumber: s.season_number, name: s.name, airDate: s.air_date || null, episodeCount: s.episode_count, posterPath: s.poster_path })),
  };
}

export type TvEpisode = { episodeNumber: number; name: string | null; airDate: string | null; runtime: number | null; tmdbEpisodeId: number };

export async function getTvSeason(tmdbTvId: number, seasonNumber: number): Promise<TvEpisode[]> {
  const s = await get<{ episodes: { episode_number: number; name: string | null; air_date: string | null; runtime: number | null; id: number }[] }>(
    `/tv/${tmdbTvId}/season/${seasonNumber}`,
  );
  return s.episodes.map((e) => ({ episodeNumber: e.episode_number, name: e.name, airDate: e.air_date || null, runtime: e.runtime ?? null, tmdbEpisodeId: e.id }));
}

export type TvImdbMatch = { kind: "show"; tmdbTvId: number } | { kind: "episode"; tmdbTvId: number; seasonNumber: number; episodeNumber: number };

/** What an IMDb TV id (series or episode) is on TMDB, or null if TMDB doesn't know it. */
export async function findTvByImdbId(imdbId: string): Promise<TvImdbMatch | null> {
  const d = await get<{ tv_results?: { id: number }[]; tv_episode_results?: { show_id: number; season_number: number; episode_number: number }[] }>(
    `/find/${imdbId}`, { external_source: "imdb_id" },
  );
  if (d.tv_results?.[0]) return { kind: "show", tmdbTvId: d.tv_results[0].id };
  const e = d.tv_episode_results?.[0];
  return e ? { kind: "episode", tmdbTvId: e.show_id, seasonNumber: e.season_number, episodeNumber: e.episode_number } : null;
}