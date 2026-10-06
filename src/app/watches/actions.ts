"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { formatKind, viewingFormats, watches } from "@/db/schema";
import { enrichFilms, linkTmdbId } from "@/db/film-link";
import { findFilmSuggestions, type FilmSuggestion } from "@/db/suggestions";
import { matchKey } from "@/lib/match-key";

export type LogWatchState = { error?: string };
export type { FilmSuggestion };

type Kind = (typeof formatKind.enumValues)[number];
const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const fold = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** Film suggestions while typing: your log and shelf first, then TMDB. */
export async function suggestFilms(query: string): Promise<FilmSuggestion[]> {
  return findFilmSuggestions(query);
}

/** Logs a watch of any film, owned or not. Can create a new viewing format on the way. */
export async function addWatch(_prev: LogWatchState, form: FormData): Promise<LogWatchState> {
  const title = text(form.get("title"));
  const yearText = text(form.get("year"));
  const formatChoice = text(form.get("format_id"));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  // Most watches are logged straight after watching, so a blank date means today.
  const watchedOn = text(form.get("watched_on")) || today;

  if (!title) return { error: "What did you watch? Add the film title." };
  let year: number | null = null;
  if (yearText) {
    year = Number(yearText);
    if (!Number.isInteger(year) || year < 1880 || year > new Date().getFullYear() + 2) {
      return { error: "The release year should be a four-digit year, like 1986." };
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(watchedOn) || watchedOn > today || watchedOn < "1900-01-01") {
    return { error: "Check the date. It can't be in the future." };
  }

  let formatId: number;
  if (formatChoice === "new") {
    const name = text(form.get("new_format_name"));
    const kind = text(form.get("new_format_kind")) as Kind;
    if (!name) return { error: "Give the new format a name." };
    if (!formatKind.enumValues.includes(kind)) return { error: "Choose what kind of format it is." };
    // Reuse an existing format if the name (or one of its aliases) already exists.
    const all = await db.select().from(viewingFormats);
    const existing = all.find((f) => fold(f.name) === fold(name) || f.aliases.some((a) => fold(a) === fold(name)));
    formatId = existing
      ? existing.id
      : (await db.insert(viewingFormats).values({ name, kind }).returning({ id: viewingFormats.id }))[0].id;
  } else {
    const [f] = await db.select().from(viewingFormats).where(eq(viewingFormats.id, Number(formatChoice)));
    if (!f) return { error: "Choose where you watched it." };
    formatId = f.id;
  }

  // A TMDB pick brings its ID; a typed title inherits the link of the same film already logged.
  const tmdbText = text(form.get("tmdb_id"));
  const tmdbId = await linkTmdbId(title, year, /^\d+$/.test(tmdbText) ? Number(tmdbText) : null);

  await db.insert(watches).values({
    title,
    releaseYear: year,
    watchedOn,
    formatId,
    formatFromMemory: false,
    matchKey: matchKey(title, year),
    tmdbId,
  });
  // Cast, crew and genres for stats.
  await enrichFilms([tmdbId]);

  revalidatePath("/");
  revalidatePath("/watches");
  redirect(`/watches?${new URLSearchParams({ logged: title })}`);
}
