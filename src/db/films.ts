import "server-only";
import { db } from ".";
import { films } from "./schema";
import { getMovie } from "@/lib/tmdb";

/** Fetches a film's TMDB details and stores them. Returns false if TMDB couldn't be reached. */
export async function cacheFilm(tmdbId: number): Promise<boolean> {
  try {
    const m = await getMovie(tmdbId);
    const values = {
      tmdbId: m.tmdbId,
      imdbId: m.imdbId,
      title: m.title,
      originalTitle: m.originalTitle,
      releaseDate: m.releaseDate,
      runtimeMinutes: m.runtimeMinutes,
      directors: m.directors,
      genres: m.genres,
      posterPath: m.posterPath,
      fetchedAt: new Date(),
    };
    await db.insert(films).values(values).onConflictDoUpdate({ target: films.tmdbId, set: values });
    return true;
  } catch (e) {
    console.error("TMDB lookup failed", tmdbId, e);
    return false;
  }
}
