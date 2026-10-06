import "server-only";
import { normaliseTitle } from "./match-key";
import { getTitles, getUkReleaseYear, searchMovies, type TmdbSearchResult } from "./tmdb";

export type MatchCandidate = { tmdbId: number; title: string; year: number | null; posterPath: string | null; via: string };
export type MatchResult = {
  status: "auto" | "review" | "unmatched";
  tmdbId: number | null;
  method: string | null;
  candidates: MatchCandidate[];
};

/** English-language releases whose alternative titles are worth matching on. */
const ENGLISH_COUNTRIES = new Set(["GB", "US", "IE", "AU", "CA", "NZ"]);
const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12" };

/**
 * Title comparison for matching: the app's normalisation, plus Roman numerals as
 * digits (after the first word, so "V for Vendetta" and "X" are left alone) and
 * any bracketed note such as "(Director's Cut)" dropped.
 */
export function compareTitle(title: string): string {
  const words = title.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean);
  return normaliseTitle(words.map((w, i) => (i > 0 ? (ROMAN[w.toLowerCase().replace(/[^a-z]/g, "")] ?? w) : w)).join(" "));
}

const toCandidate = (r: TmdbSearchResult, via: string): MatchCandidate => ({ tmdbId: r.tmdbId, title: r.title, year: r.year, posterPath: r.posterPath, via });

/** Trigram similarity (0-1) of two titles, like Postgres pg_trgm. Used only to suggest candidates for review. */
export function titleSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const out = new Set<string>();
    const words = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);
    for (const w of words) {
      const p = `  ${w} `;
      for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    }
    return out;
  };
  const A = grams(a), B = grams(b);
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return shared / (A.size + B.size - shared || 1);
}

/**
 * Finds the TMDB film for a title as entered. Only an exact title + year match
 * with a single result links automatically; anything less certain is offered
 * for review, so two different films are never merged by mistake.
 */
export async function matchFilm(title: string, year: number | null): Promise<MatchResult> {
  const key = compareTitle(title);
  const withYear = year ? await searchMovies(title, year) : [];

  const exact = withYear.filter((c) => compareTitle(c.title) === key && c.year === year);
  if (exact.length === 1) return { status: "auto", tmdbId: exact[0].tmdbId, method: "exact title and year", candidates: [toCandidate(exact[0], "exact")] };
  if (exact.length > 1) {
    // Always your call, never picked automatically. Best-known first, with rating counts to help.
    const byFame = exact.slice().sort((a, b) => b.voteCount - a.voteCount);
    return { status: "review", tmdbId: null, method: "several films with this title and year", candidates: byFame.map((c) => toCandidate(c, `same title and year, ${c.voteCount} ratings`)) };
  }

  const noYear = await searchMovies(title);
  const seen = new Set<number>();
  const pool = [...withYear, ...noYear].filter((c) => !seen.has(c.tmdbId) && seen.add(c.tmdbId)).slice(0, 12);
  const yearGap = (c: TmdbSearchResult) => (year && c.year ? Math.abs(c.year - year) : 99);
  const sameTitle = pool.filter((c) => compareTitle(c.title) === key);

  if (!year) {
    if (sameTitle.length) return { status: "review", tmdbId: null, method: "no release year recorded", candidates: sameTitle.map((c) => toCandidate(c, "same title")) };
  } else {
    // UK first: the year you have is often the UK release, a year or two after the first release elsewhere.
    const ukMatches: TmdbSearchResult[] = [];
    for (const c of sameTitle.filter((c) => yearGap(c) <= 3).slice(0, 4)) {
      if ((await getUkReleaseYear(c.tmdbId)) === year) ukMatches.push(c);
    }
    if (ukMatches.length === 1) {
      return { status: "auto", tmdbId: ukMatches[0].tmdbId, method: `UK release year ${year}`, candidates: [toCandidate(ukMatches[0], `UK release ${year}`)] };
    }
    if (ukMatches.length > 1) {
      const byFame = ukMatches.slice().sort((a, b) => b.voteCount - a.voteCount);
      return { status: "review", tmdbId: null, method: `several films released in the UK in ${year}`, candidates: byFame.map((c) => toCandidate(c, `UK release ${year}, ${c.voteCount} ratings`)) };
    }

    // Same title, close year, but not the UK year either.
    const close = sameTitle.filter((c) => yearGap(c) <= 1);
    if (close.length) {
      return { status: "review", tmdbId: null, method: `year differs (you have ${year})`, candidates: close.map((c) => toCandidate(c, `same title, ${c.year}`)) };
    }
    // TMDB's year search matches any country's release that year: same title released in your year somewhere.
    const releasedThatYear = withYear.filter((c) => compareTitle(c.title) === key);
    if (releasedThatYear.length) {
      return { status: "review", tmdbId: null, method: `first released ${releasedThatYear[0].year}, also released in ${year}`, candidates: releasedThatYear.map((c) => toCandidate(c, `released ${year} somewhere`)) };
    }
  }

  // Known by another name: check English-language alternative titles of the nearest few films.
  // One film known by that English title, released that year (first release or UK), is linked;
  // several, or a different year, is for review.
  const nearby = pool.filter((c) => !year || yearGap(c) <= 2).slice(0, 5);
  const akaHits: { c: TmdbSearchResult; via: string; sameYear: boolean }[] = [];
  for (const c of nearby) {
    const titles = await getTitles(c.tmdbId);
    const hit = titles.find((t) => compareTitle(t.title) === key && (t.kind !== "alternative" || (t.country && ENGLISH_COUNTRIES.has(t.country))));
    if (!hit) continue;
    const via = hit.kind === "original" ? `original title "${hit.title}"` : `also known as "${hit.title}"${hit.country ? ` (${hit.country})` : ""}`;
    const sameYear = !!year && (c.year === year || (await getUkReleaseYear(c.tmdbId)) === year);
    akaHits.push({ c, via, sameYear });
  }
  if (akaHits.length === 1 && akaHits[0].sameYear) {
    const { c, via } = akaHits[0];
    return { status: "auto", tmdbId: c.tmdbId, method: "known by another English title, same year", candidates: [toCandidate(c, via)] };
  }
  if (akaHits.length) return { status: "review", tmdbId: null, method: "known by another title", candidates: akaHits.map((h) => toCandidate(h.c, h.via)) };

  // Same title but a quite different year: usually a typo in the year (e.g. Batman Begins entered as 2012).
  if (sameTitle.length) {
    return {
      status: "review",
      tmdbId: null,
      method: `same title, different year (you have ${year})`,
      candidates: sameTitle.slice().sort((a, b) => yearGap(a) - yearGap(b)).map((c) => toCandidate(c, `same title, ${c.year}`)),
    };
  }

  // A similar title from the same year (shortened, reworded, or a small typo): for review, never linked automatically.
  // Also search on the parts either side of a colon or dash: "Star Wars: Episode VII - The Force Awakens".
  // If nothing came back at all (often a typo later in the title), retry with the first two words.
  const parts = title.split(/\s*[:–—]\s*|\s+-\s+/).map((p) => p.trim()).filter((p) => p.length >= 4 && p !== title);
  const words = title.split(/\s+/).filter(Boolean);
  if (!pool.length && words.length > 2) parts.push(words.slice(0, 2).join(" "));
  const extra: TmdbSearchResult[] = [];
  for (const p of parts.slice(0, 4)) extra.push(...(await searchMovies(p, year ?? undefined)));
  const wider = [...pool, ...extra.filter((c) => !seen.has(c.tmdbId) && seen.add(c.tmdbId))];
  // Your title is the start of TMDB's longer one ("We steal secrets" / "…: The Story of WikiLeaks"), or vice versa.
  const startsAlike = (c: TmdbSearchResult) => {
    const theirs = compareTitle(c.title);
    const [short, long] = key.length <= theirs.length ? [key, theirs] : [theirs, key];
    return short.length >= 6 && long.startsWith(short);
  };
  const similar = wider
    .map((c) => ({ c, sim: startsAlike(c) ? Math.max(0.9, titleSimilarity(title, c.title)) : titleSimilarity(title, c.title) }))
    .filter(({ c, sim }) => sim >= 0.45 && (!year || yearGap(c) <= 1))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 4);
  if (similar.length) {
    return {
      status: "review",
      tmdbId: null,
      method: "similar title",
      candidates: similar.map(({ c, sim }) => toCandidate(c, `similar title (${Math.round(sim * 100)}%), ${c.year ?? "no year"}`)),
    };
  }

  // Nothing convincing: keep the closest results so you can pick one by hand.
  const fallback = wider.slice().sort((a, b) => yearGap(a) - yearGap(b)).slice(0, 5);
  return { status: "unmatched", tmdbId: null, method: null, candidates: fallback.map((c) => toCandidate(c, "search result")) };
}
