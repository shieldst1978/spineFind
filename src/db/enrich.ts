import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { filmCredits, films, filmTitles, people } from "./schema";
import type { TmdbMovieFull } from "@/lib/tmdb";

/** Stores a film's full TMDB record: details, people, credits and titles. Safe to re-run. */
export async function storeFilm(db: Db, m: TmdbMovieFull) {
  await db.transaction(async (tx) => {
    const details = {
      imdbId: m.imdbId,
      title: m.title,
      originalTitle: m.originalTitle,
      releaseDate: m.releaseDate,
      ukReleaseDate: m.ukReleaseDate,
      runtimeMinutes: m.runtimeMinutes,
      directors: m.directors,
      genres: m.genres,
      posterPath: m.posterPath,
      overview: m.overview,
      keywords: m.keywords,
      countries: m.countries,
      originalLanguage: m.originalLanguage,
      ukCertificate: m.ukCertificate,
      collectionId: m.collection?.id ?? null,
      collectionName: m.collection?.name ?? null,
      voteAverage: m.voteAverage,
      voteCount: m.voteCount,
      enrichedAt: new Date(),
      fetchedAt: new Date(),
    };
    await tx.insert(films).values({ tmdbId: m.tmdbId, ...details }).onConflictDoUpdate({ target: films.tmdbId, set: details });

    // People are shared across films; keep their latest name and photo.
    const persons = [...new Map(m.credits.map((c) => [c.personId, c])).values()];
    if (persons.length) {
      await tx
        .insert(people)
        .values(persons.map((p) => ({ tmdbPersonId: p.personId, name: p.name, profilePath: p.profilePath })))
        .onConflictDoUpdate({ target: people.tmdbPersonId, set: { name: sql`excluded.name`, profilePath: sql`excluded.profile_path` } });
    }

    // Credits and titles are replaced wholesale so a re-run reflects TMDB as it is now.
    await tx.delete(filmCredits).where(sql`${filmCredits.tmdbId} = ${m.tmdbId}`);
    const credits = [...new Map(m.credits.map((c) => [`${c.personId}|${c.role}|${c.job}`, c])).values()];
    if (credits.length) {
      await tx.insert(filmCredits).values(
        credits.map((c) => ({ tmdbId: m.tmdbId, personId: c.personId, role: c.role, job: c.job, character: c.character, billing: c.billing })),
      );
    }
    await tx.delete(filmTitles).where(sql`${filmTitles.tmdbId} = ${m.tmdbId}`);
    const titles = [...new Map(m.titles.map((t) => [`${t.title}|${t.country ?? ""}`, t])).values()];
    if (titles.length) await tx.insert(filmTitles).values(titles.map((t) => ({ tmdbId: m.tmdbId, title: t.title, kind: t.kind, country: t.country })));
  });
}
