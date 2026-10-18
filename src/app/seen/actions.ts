"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { removeFromWatchlist } from "@/db/watchlist";
import { text } from "@/lib/form-values";

/**
 * Marks the ticked films as seen (the film, not your disc): they go in
 * seen_films, so Pick, Stats and Ask count them as watched while the
 * shelf's ✓ stays for discs you've actually watched.
 */
export async function markSeenBefore(form: FormData) {
  const keys = [...new Set(form.getAll("film").map((v) => text(v)).filter((k) => k && k.length < 300))];
  if (keys.length) {
    await db.execute(sql`
      insert into seen_films (film_key, tmdb_id, title, release_year, source)
      select film_key, tmdb_id, title, release_year, 'seen-page' from assistant_films where film_key in ${keys}
      on conflict (film_key) do nothing`);
    await removeFromWatchlist(keys);
  }
  revalidatePath("/", "layout");
  const where = text(form.get("where"));
  const p = new URLSearchParams({ saved: String(keys.length) });
  if (where === "shelf" || where === "loft") p.set("where", where);
  // Stay on the page you were on (films you skipped stay on earlier pages).
  const page = text(form.get("page"));
  if (/^\d{1,4}$/.test(page) && page !== "1") p.set("page", page);
  redirect(`/seen?${p}`);
}
