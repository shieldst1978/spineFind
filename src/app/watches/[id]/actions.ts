"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { viewingFormats, watches } from "@/db/schema";
import { parseWatchDate, parseYear, text, UUID } from "@/lib/form-values";
import { matchKey } from "@/lib/match-key";

export type EditWatchState = { error?: string };

/** Only return to app pages we know about; anything else goes to the Watches list. */
function safeBack(raw: FormDataEntryValue | null | string): string {
  const back = typeof raw === "string" ? raw : "";
  return /^\/(watches|item)(\/|\?|$)/.test(back) ? back : "/watches";
}

function withParam(path: string, key: string, value: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

/** Corrects a watch: title, release year, date and format. Works for any watch, including imported ones. */
export async function updateWatch(watchId: string, _prev: EditWatchState, form: FormData): Promise<EditWatchState> {
  if (!UUID.test(watchId)) return { error: "That watch doesn't exist." };
  const [current] = await db.select().from(watches).where(eq(watches.id, watchId));
  if (!current) return { error: "That watch doesn't exist any more." };

  const title = text(form.get("title"));
  if (!title) return { error: "The film needs a title." };
  const year = parseYear(text(form.get("year")));
  if ("error" in year) return year;
  const date = parseWatchDate(text(form.get("watched_on")));
  if ("error" in date) return date;
  const [format] = await db.select().from(viewingFormats).where(eq(viewingFormats.id, Number(text(form.get("format_id")))));
  if (!format) return { error: "Choose where you watched it." };

  const sameFilm = title === current.title && year.year === current.releaseYear;
  await db
    .update(watches)
    .set({
      title,
      releaseYear: year.year,
      watchedOn: date.date,
      formatId: format.id,
      // Choosing the format now confirms it, even for an aNote-era watch.
      formatFromMemory: format.id === current.formatId ? current.formatFromMemory : false,
      matchKey: matchKey(title, year.year),
      // A different film no longer matches the old TMDB entry.
      tmdbId: sameFilm ? current.tmdbId : null,
      updatedAt: new Date(),
    })
    .where(eq(watches.id, watchId));

  revalidatePath("/", "layout");
  redirect(withParam(safeBack(form.get("back")), "updated", title));
}

/** Deletes a watch. The form must carry confirm=yes (the second tap). */
export async function deleteWatch(watchId: string, form: FormData) {
  const back = safeBack(form.get("back"));
  if (!UUID.test(watchId) || text(form.get("confirm")) !== "yes") redirect(back);
  const [gone] = await db.delete(watches).where(eq(watches.id, watchId)).returning({ title: watches.title });
  revalidatePath("/", "layout");
  redirect(gone ? withParam(back, "deleted", gone.title) : back);
}
