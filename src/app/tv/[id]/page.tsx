import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listViewingFormats } from "@/db/queries";
import { showPage, type SeasonRow } from "@/db/tv";
import { todayUk } from "@/lib/form-values";
import { FormatOptions } from "@/components/format-options";
import { WatchTabs } from "@/components/watch-tabs";
import { logNextEpisode, logSeasonEpisodes } from "../actions";

export const metadata: Metadata = { title: "TV show · SpineFind" };

const field = "w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 py-2 text-base sm:text-sm dark:border-stone-700 dark:bg-stone-900";
type Format = { id: number; name: string; kind: string; lastUsed?: string | null };

export default async function TvShowPage({ params, searchParams }: PageProps<"/tv/[id]">) {
  const { id } = await params;
  const tmdbTvId = Number(id);
  if (!Number.isInteger(tmdbTvId) || tmdbTvId <= 0) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const openSeason = /^\d{1,3}$/.test(one(sp.season)) ? Number(one(sp.season)) : undefined;
  const [page, formats] = await Promise.all([showPage(tmdbTvId, openSeason).catch(() => null), listViewingFormats()]);
  if (!page) notFound();
  const { show, seasons, next, watchedEpisodes, totalEpisodes } = page;
  // Default format: what you last watched this show on, else the format matching its network (Apple TV, Netflix…),
  // else your most used non-disc format.
  const fold = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byNetwork = formats.find((f) => f.kind !== "disc" && show.networks.some((n) => fold(n) === fold(f.name) || fold(f.name).startsWith(fold(n)) || fold(n).startsWith(fold(f.name))));
  const defaultFormat = page.lastFormatId ?? byNetwork?.id ?? formats.find((f) => f.kind !== "disc")?.id ?? formats[0]?.id;
  const today = todayUk();
  const years = [show.firstAirDate?.slice(0, 4), show.status === "Ended" ? show.lastAirDate?.slice(0, 4) : ""].filter(Boolean).join("–");
  const facts = [show.networks.slice(0, 2).join(", "), show.creators.length ? `created by ${show.creators.slice(0, 2).join(", ")}` : "", show.status].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto w-full min-w-0 max-w-xl flex-1 space-y-5 px-4 py-6">
      <WatchTabs active="tv-log" />
      <header className="flex gap-3">
        {show.posterPath ? (
          <Image src={`https://image.tmdb.org/t/p/w185${show.posterPath}`} alt="" width={72} height={108} className="h-[108px] w-[72px] shrink-0 rounded object-cover" />
        ) : null}
        <div className="min-w-0 space-y-1">
          <h1 className="break-words text-2xl font-semibold tracking-tight">{show.name}{years && <span className="font-normal text-stone-500"> ({years})</span>}</h1>
          {facts && <p className="text-sm text-stone-600 dark:text-stone-400">{facts}</p>}
          <p className="text-sm">{watchedEpisodes} of {totalEpisodes} episodes seen</p>
        </div>
      </header>

      {one(sp.logged) && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">Logged {one(sp.logged)}.</p>
      )}
      {one(sp.error) && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{one(sp.error)}</p>}

      {next && (
        <form action={logNextEpisode.bind(null, tmdbTvId, next.seasonNumber, next.episodeNumber)}
          className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <p className="text-sm">
            <span className="text-stone-500">{watchedEpisodes ? "Next" : "Start with"}:</span>{" "}
            <strong className="font-medium">S{next.seasonNumber} E{next.episodeNumber}</strong>{next.name && ` · ${next.name}`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" name="watched_on" defaultValue={today} max={today} className={field} aria-label="Date watched" />
            <FormatSelect formats={formats} defaultValue={defaultFormat} />
          </div>
          <button type="submit" className="w-full rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white dark:bg-stone-100 dark:text-stone-900">Watched it</button>
        </form>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Seasons</h2>
        {seasons.filter((s) => s.seasonNumber > 0).concat(seasons.filter((s) => s.seasonNumber === 0)).map((s) => (
          <Season key={s.seasonNumber} tmdbTvId={tmdbTvId} s={s} open={openSeason === s.seasonNumber || (s.watched > 0 && s.watched < s.episodeCount)}
            formats={formats} defaultFormat={defaultFormat} today={today} />
        ))}
      </section>
      <p className="text-xs text-stone-500">Show and episode data from TMDB. <Link href="/watches/tv" className="underline">Your TV log</Link></p>
    </main>
  );
}

function FormatSelect({ formats, defaultValue }: { formats: Format[]; defaultValue?: number }) {
  return (
    <select name="format_id" defaultValue={defaultValue} className={field} aria-label="Watched on">
      <FormatOptions formats={formats} />
    </select>
  );
}

function Season({ tmdbTvId, s, open, formats, defaultFormat, today }: {
  tmdbTvId: number; s: SeasonRow; open: boolean; formats: Format[]; defaultFormat?: number; today: string;
}) {
  const done = s.episodeCount > 0 && s.watched >= s.episodeCount;
  const label = s.seasonNumber === 0 ? (s.name ?? "Specials") : `Season ${s.seasonNumber}`;
  return (
    <details open={open} className="rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-sm">
        <span>{label}{s.airDate && <span className="text-stone-500"> · {s.airDate.slice(0, 4)}</span>}</span>
        <span className={done ? "text-emerald-700 dark:text-emerald-400" : "text-stone-500"}>{done ? "✓ " : ""}{s.watched} / {s.episodeCount}</span>
      </summary>
      {s.episodes === null ? (
        <p className="border-t border-stone-100 px-3 py-2 text-sm dark:border-stone-800">
          <Link href={`/tv/${tmdbTvId}?season=${s.seasonNumber}`} className="underline">Show episodes</Link>
        </p>
      ) : (
        <form action={logSeasonEpisodes.bind(null, tmdbTvId, s.seasonNumber)} className="space-y-3 border-t border-stone-100 px-3 py-3 dark:border-stone-800">
          <ul className="space-y-1">
            {s.episodes.map((e) => (
              <li key={e.episodeNumber}>
                <label className="flex min-h-10 items-center gap-3 text-sm">
                  <input type="checkbox" name="episode" value={e.episodeNumber} className="size-5 shrink-0" />
                  <span className="w-8 shrink-0 tabular-nums text-stone-500">E{e.episodeNumber}</span>
                  <span className="min-w-0 flex-1 break-words">{e.name ?? `Episode ${e.episodeNumber}`}</span>
                  {e.times > 0 ? (
                    <span className="shrink-0 text-xs text-emerald-700 dark:text-emerald-400">✓{e.times > 1 ? ` ×${e.times}` : ""}</span>
                  ) : e.seen ? (
                    <span className="shrink-0 text-xs text-stone-500" title="Seen before, no date (e.g. from IMDb)">✓ seen</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" name="watched_on" defaultValue={today} max={today} className={field} aria-label="Date watched" />
            <FormatSelect formats={formats} defaultValue={defaultFormat} />
          </div>
          <label className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
            <input type="checkbox" name="from_memory" value="yes" className="size-4" /> From memory (the date is roughly when)
          </label>
          <div className="flex gap-2">
            <button type="submit" name="what" value="ticked" className="flex-1 rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-900">Log ticked</button>
            <button type="submit" name="what" value="season" className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm dark:border-stone-700">Whole season</button>
          </div>
        </form>
      )}
    </details>
  );
}
