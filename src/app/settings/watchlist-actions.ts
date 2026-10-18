"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { enrichFilms } from "@/db/film-link";
import { refreshWatchlistAvailability } from "@/db/streaming";
import { syncWatchlist } from "@/db/watchlist";

/** Syncs the watchlist from an uploaded IMDb watchlist CSV, then fetches TMDB details and availability in the background. */
export async function uploadWatchlist(form: FormData) {
  const file = form.get("csv");
  if (!(file instanceof File) || file.size === 0) redirect("/settings?watchlist_error=Choose+your+IMDb+watchlist+CSV+first.");
  if (file.size > 2_000_000) redirect("/settings?watchlist_error=That+file+is+too+big+for+a+watchlist.");
  let summary: string;
  try {
    const r = await syncWatchlist(await file.text());
    summary = new URLSearchParams({
      wl_added: String(r.added), wl_kept: String(r.kept), wl_removed: String(r.removed),
      wl_seen: String(r.skippedSeen), wl_tv: String(r.skippedTv), wl_missing: String(r.notOnTmdb),
    }).toString();
    after(async () => {
      await enrichFilms(r.newTmdbIds);
      await refreshWatchlistAvailability();
    });
  } catch (e) {
    summary = new URLSearchParams({ watchlist_error: (e as Error).message }).toString();
  }
  revalidatePath("/", "layout");
  redirect(`/settings?${summary}#watchlist`);
}
