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

/**
 * Not a film at all (a TV series logged or shelved as one): leave it unlinked,
 * and mark its box entries as TV so they drop out of film stats and watched status.
 */
export async function markAsTv(matchKey: string, form: FormData) {
  await db.transaction(async (tx) => {
    await tx.update(tmdbMatches).set({ status: "rejected", tmdbId: null, method: "TV, not a film", checkedAt: new Date() }).where(eq(tmdbMatches.matchKey, matchKey));
    await tx.execute(sql`update items set item_type = 'tv_season', tmdb_id = null, updated_at = now() where match_key = ${matchKey} and item_type = 'film'`);
    await tx.execute(sql`update watches set tmdb_id = null, updated_at = now() where match_key = ${matchKey}`);
  });
  revalidatePath("/", "layout");
  redirect(backTo(form));
}

/**
 * Undoes a match (yours or automatic): unlinks its boxes and watches and puts it
 * back at the top of the review list. Entries whose year you corrected are found
 * by title and the TMDB film they were linked to.
 */
export async function reopenMatch(matchKey: string) {
  const [entry] = await db.select().from(tmdbMatches).where(eq(tmdbMatches.matchKey, matchKey));
  if (entry) {
    const titleKey = matchKey.replace(/\|.*$/, "");
    await db.transaction(async (tx) => {
      await tx.update(tmdbMatches).set({ status: "review", tmdbId: null, method: "reopened by you", checkedAt: new Date() }).where(eq(tmdbMatches.matchKey, matchKey));
      for (const table of ["items", "watches"] as const) {
        await tx.execute(sql`update ${sql.identifier(table)} set tmdb_id = null, updated_at = now()
          where match_key = ${matchKey} or (${entry.tmdbId}::int is not null and tmdb_id = ${entry.tmdbId} and split_part(match_key, '|', 1) = ${titleKey})`);
      }
      // A TV mark is undone too.
      if (entry.method === "TV, not a film") {
        await tx.execute(sql`update items set item_type = 'film', updated_at = now() where match_key = ${matchKey} and item_type = 'tv_season'`);
      }
    });
  }
  revalidatePath("/", "layout");
  redirect("/review");
}

/** None of the candidates is right: leave it unlinked and don't ask again. */
export async function rejectMatch(matchKey: string, form: FormData) {
  await db.update(tmdbMatches).set({ status: "rejected", tmdbId: null, method: "none of these, said you", checkedAt: new Date() }).where(eq(tmdbMatches.matchKey, matchKey));
  revalidatePath("/review");
  redirect(backTo(form));
}
