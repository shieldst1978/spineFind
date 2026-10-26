"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { enrichFilms } from "@/db/film-link";
import { importSeenFromImdb, importTvSeenFromImdb } from "@/db/imdb";
import { refreshWatchlistAvailability } from "@/db/streaming";
import { syncWatchlist } from "@/db/watchlist";

const MAX_BYTES = 5_000_000;

async function readCsv(v: FormDataEntryValue | null): Promise<string | null> {
  if (!(v instanceof File) || v.size === 0) return null;
  if (v.size > MAX_BYTES) throw new Error(`${v.name} is too big for an IMDb export.`);
  return v.text();
}

/**
 * Settings → IMDb: takes a watch-history (or ratings) export and/or a watchlist export in one go.
 * The history goes first, so films you've now seen come off the watchlist before it's synced.
 * TMDB details and streaming availability for new films are fetched after the page is sent.
 */
export async function uploadImdb(form: FormData) {
  const p = new URLSearchParams();
  const newIds: number[] = [];
  try {
    const history = await readCsv(form.get("history"));
    const list = await readCsv(form.get("watchlist"));
    if (!history && !list) throw new Error("Choose your watch history and/or watchlist CSV first.");
    if (history) {
      const r = await importSeenFromImdb(history);
      newIds.push(...r.newTmdbIds);
      p.set("seen_marked", String(r.marked));
      p.set("seen_logged", String(r.logged + r.alreadySeen));
      p.set("seen_tv", String(r.skippedTv));
      p.set("seen_off", String(r.offWatchlist));
      const tv = await importTvSeenFromImdb(history);
      p.set("tv_shows", String(tv.series + tv.episodes ? tv.shows : 0));
      p.set("tv_marked", String(tv.marked));
    }
    if (list) {
      const r = await syncWatchlist(list);
      newIds.push(...r.newTmdbIds);
      p.set("wl_added", String(r.added));
      p.set("wl_kept", String(r.kept));
      p.set("wl_removed", String(r.removed));
      p.set("wl_seen", String(r.skippedSeen));
      p.set("wl_tv", String(r.skippedTv));
      p.set("wl_missing", String(r.notOnTmdb));
    }
    after(async () => {
      await enrichFilms([...new Set(newIds)]);
      await refreshWatchlistAvailability();
    });
  } catch (e) {
    p.set("imdb_error", (e as Error).message);
  }
  revalidatePath("/", "layout");
  redirect(`/settings?${p}#imdb`);
}
