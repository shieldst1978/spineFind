"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { storeFilm } from "@/db/enrich";
import { films, tmdbMatches } from "@/db/schema";
import { text } from "@/lib/form-values";
import { getMovieFull } from "@/lib/tmdb";

const backTo = (form: FormData) => {
  const page = text(form.get("page"));
  return /^\d+$/.test(page) && page !== "1" ? `/review?page=${page}` : "/review";
};

/**
 * Links a film as you entered it to the TMDB film you chose: fetches its full
 * record, marks the match confirmed, and links every box and watch using that
 * title + year. Optionally corrects your release year to TMDB's.
 */
export async function confirmMatch(matchKey: string, form: FormData) {
  const tmdbId = Number(text(form.get("tmdb_id")));
  const fixYear = text(form.get("fix_year")) === "yes";
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) redirect(backTo(form));
  const [entry] = await db.select().from(tmdbMatches).where(eq(tmdbMatches.matchKey, matchKey));
  if (!entry) redirect(backTo(form));

  const [known] = await db.select({ enrichedAt: films.enrichedAt }).from(films).where(eq(films.tmdbId, tmdbId));
  const full = known?.enrichedAt ? null : await getMovieFull(tmdbId);
  if (full) await storeFilm(db, full);
  const year = fixYear ? Number((full?.releaseDate ?? (await db.select({ d: films.releaseDate }).from(films).where(eq(films.tmdbId, tmdbId)))[0]?.d ?? "").slice(0, 4)) || null : null;

  await db.transaction(async (tx) => {
    await tx.update(tmdbMatches).set({ status: "confirmed", tmdbId, method: "confirmed by you", checkedAt: new Date() }).where(eq(tmdbMatches.matchKey, matchKey));
    for (const table of ["items", "watches"] as const) {
      if (year) {
        // Correct the year as well; the title stays exactly as you entered it.
        await tx.execute(sql`update ${sql.identifier(table)} set tmdb_id = ${tmdbId}, release_year = ${year},
          match_key = regexp_replace(match_key, '\\|.*$', ${`|${year}`}), updated_at = now() where match_key = ${matchKey}`);
      } else {
        await tx.execute(sql`update ${sql.identifier(table)} set tmdb_id = ${tmdbId}, updated_at = now() where match_key = ${matchKey}`);
      }
    }
  });

  revalidatePath("/", "layout");
  redirect(backTo(form));
}

/** None of the candidates is right: leave it unlinked and don't ask again. */
export async function rejectMatch(matchKey: string, form: FormData) {
  await db.update(tmdbMatches).set({ status: "rejected", tmdbId: null, method: "none of these, said you", checkedAt: new Date() }).where(eq(tmdbMatches.matchKey, matchKey));
  revalidatePath("/review");
  redirect(backTo(form));
}
