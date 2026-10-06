import "server-only";
import { eq } from "drizzle-orm";
import { db } from ".";
import { storeFilm } from "./enrich";
import { films, items } from "./schema";
import { normaliseTitle } from "@/lib/match-key";
import { getMovieFull, searchMovies, tmdbEnabled } from "@/lib/tmdb";

export type FilmDetails = typeof films.$inferSelect;

/** Fetches a film's full TMDB record (details, cast, crew, titles) and stores it. Returns false if TMDB couldn't be reached. */
export async function cacheFilm(tmdbId: number): Promise<boolean> {
  try {
    await storeFilm(db, await getMovieFull(tmdbId));
    return true;
  } catch (e) {
    console.error("TMDB lookup failed", tmdbId, e);
    return false;
  }
}

/**
 * TMDB details for a catalogue item, looked up on first use and remembered.
 * Only accepts a TMDB film whose title and year both match, so a wrong guess
 * never gets attached; returns null when there's no confident match.
 */
export async function detailsForItem(item: { id: string; title: string; year: number | null }): Promise<FilmDetails | null> {
  const [row] = await db.select({ tmdbId: items.tmdbId, matchKey: items.matchKey }).from(items).where(eq(items.id, item.id));
  if (!row) return null;

  let tmdbId = row.tmdbId;
  if (!tmdbId) {
    if (!tmdbEnabled() || !item.year) return null;
    try {
      const results = await searchMovies(item.title, item.year);
      const want = normaliseTitle(item.title);
      const hit = results.find((r) => r.year === item.year && normaliseTitle(r.title) === want);
      if (!hit) return null;
      tmdbId = hit.tmdbId;
      // Every copy of the same film (same title + year) shares the ID.
      await db.update(items).set({ tmdbId }).where(eq(items.matchKey, row.matchKey));
    } catch (e) {
      console.error("TMDB search failed", item.title, e);
      return null;
    }
  }

  const [cached] = await db.select().from(films).where(eq(films.tmdbId, tmdbId));
  if (cached) return cached;
  if (!(await cacheFilm(tmdbId))) return null;
  const [fresh] = await db.select().from(films).where(eq(films.tmdbId, tmdbId));
  return fresh ?? null;
}
