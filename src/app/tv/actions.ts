"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { viewingFormats } from "@/db/schema";
import { deleteTvWatch, ensureSeason, logEpisodes } from "@/db/tv";
import { parseWatchDate, text, UUID } from "@/lib/form-values";

async function formatFrom(form: FormData) {
  const [f] = await db.select({ id: viewingFormats.id }).from(viewingFormats).where(eq(viewingFormats.id, Number(text(form.get("format_id")))));
  return f?.id ?? null;
}

function back(tmdbTvId: number, params: Record<string, string>): never {
  revalidatePath(`/tv/${tmdbTvId}`);
  revalidatePath("/tv");
  redirect(`/tv/${tmdbTvId}?${new URLSearchParams(params)}`);
}

/** "Watched next episode": today (or the date given), in the format chosen. */
export async function logNextEpisode(tmdbTvId: number, seasonNumber: number, episodeNumber: number, form: FormData) {
  const date = parseWatchDate(text(form.get("watched_on")));
  const formatId = await formatFrom(form);
  if ("error" in date || !formatId) back(tmdbTvId, { error: "error" in date ? date.error : "Choose where you watched it." });
  await logEpisodes({ tmdbTvId, seasonNumber, episodes: [episodeNumber], watchedOn: date.date, formatId, fromMemory: false });
  back(tmdbTvId, { logged: `S${seasonNumber} E${episodeNumber}` });
}

/** Logs the ticked episodes of a season, or the whole season ("what" = "season"). */
export async function logSeasonEpisodes(tmdbTvId: number, seasonNumber: number, form: FormData) {
  const date = parseWatchDate(text(form.get("watched_on")));
  const formatId = await formatFrom(form);
  if ("error" in date || !formatId) back(tmdbTvId, { error: "error" in date ? date.error : "Choose where you watched it.", season: String(seasonNumber) });
  let episodes: number[];
  if (text(form.get("what")) === "season") {
    await ensureSeason(tmdbTvId, seasonNumber);
    const all = await db.execute<{ n: number }>(
      // Every episode TMDB lists for the season (a rewatch logs them all again).
      sql`select episode_number as n from tv_episodes where tmdb_tv_id = ${tmdbTvId} and season_number = ${seasonNumber} order by 1`,
    );
    episodes = all.rows.map((r) => r.n);
  } else {
    episodes = [...new Set(form.getAll("episode").map((v) => Number(text(v))).filter((n) => Number.isInteger(n) && n >= 0))];
  }
  if (!episodes.length) back(tmdbTvId, { error: "Tick the episodes you watched, or choose the whole season.", season: String(seasonNumber) });
  const n = await logEpisodes({ tmdbTvId, seasonNumber, episodes, watchedOn: date.date, formatId, fromMemory: text(form.get("from_memory")) === "yes" });
  back(tmdbTvId, { logged: n === 1 ? `S${seasonNumber} E${episodes[0]}` : `${n} episodes of season ${seasonNumber}`, season: String(seasonNumber) });
}

/** Deletes one TV watch (two taps: confirm=yes), returning to the TV log or the show. */
export async function removeTvWatch(id: string, form: FormData) {
  const backTo = text(form.get("back"));
  const safe = /^\/(tv|watches\/tv)(\/|\?|$)/.test(backTo) ? backTo : "/watches/tv";
  if (UUID.test(id) && text(form.get("confirm")) === "yes") await deleteTvWatch(id);
  revalidatePath("/watches/tv");
  revalidatePath("/tv", "layout");
  redirect(safe);
}
