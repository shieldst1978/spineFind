"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { enrichFilms } from "@/db/film-link";
import { refreshWatchlistAvailability } from "@/db/streaming";
import { addToWatchlist, dropFromWatchlist, restoreToWatchlist } from "@/db/watchlist";

/** Adds a TMDB film found by the watchlist page's search, then fetches its details and streaming in the background. */
export async function addFilm(tmdbId: number, title: string, year: number | null) {
  await addToWatchlist({ tmdbId, title, year });
  after(async () => {
    await enrichFilms([tmdbId]);
    await refreshWatchlistAvailability();
  });
  redirect(`/watchlist?${new URLSearchParams({ added: title })}`);
}

/** Removes one film (form field `key`), with an undo on the page it returns to. */
export async function removeFilm(form: FormData) {
  const key = String(form.get("key") ?? "");
  const view = String(form.get("view") ?? "");
  const title = key ? await dropFromWatchlist(key) : null;
  const p = new URLSearchParams(view && view !== "all" ? { view } : {});
  if (title) { p.set("removed", title); p.set("key", key); }
  redirect(`/watchlist${p.size ? `?${p}` : ""}`);
}

export async function undoRemove(key: string) {
  await restoreToWatchlist(key);
  redirect("/watchlist");
}
