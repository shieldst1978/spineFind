import type { Metadata } from "next";
import Link from "next/link";
import { listViewingFormats } from "@/db/queries";
import { tvLog, TV_LOG_PAGE } from "@/db/tv";
import { FormatOptions } from "@/components/format-options";
import { WatchTabs } from "@/components/watch-tabs";
import { editTvWatchFormat, removeTvWatch } from "@/app/tv/actions";

export const metadata: Metadata = { title: "TV log · SpineFind" };

const nth = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const field = "min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-base sm:text-sm dark:border-stone-700 dark:bg-stone-900";

/** Every TV episode logged, newest first. Kept apart from the film log. Each row can change its format or be deleted. */
export default async function TvLogPage({ searchParams }: PageProps<"/watches/tv">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [{ rows, total }, formats] = await Promise.all([tvLog(page), listViewingFormats()]);
  const pages = Math.max(1, Math.ceil(total / TV_LOG_PAGE));
  const here = page > 1 ? `/watches/tv?page=${page}` : "/watches/tv";
  const changed = one(sp.changed);
  // The watches on this page of each show in each format, for "change all of these" (episodes logged in a run share a default).
  const sameIds = new Map<string, string[]>();
  for (const r of rows) sameIds.set(`${r.tmdbTvId}|${r.formatId}`, [...(sameIds.get(`${r.tmdbTvId}|${r.formatId}`) ?? []), r.id]);

  return (
    <main className="mx-auto w-full min-w-0 max-w-2xl flex-1 space-y-4 px-4 py-6">
      <WatchTabs active="tv" />
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">TV log</h1>
        <span className="text-sm text-stone-500">{total.toLocaleString("en-GB")} episodes</span>
      </header>

      {changed && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {changed === "0" ? "Nothing to change: it was already that format." : `Changed ${changed === "1" ? "1 episode" : `${changed} episodes`}.`}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">
          No TV logged yet. <Link href="/tv" className="underline">Log an episode</Link>
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white text-sm dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {rows.map((r) => {
            const same = sameIds.get(`${r.tmdbTvId}|${r.formatId}`) ?? [r.id];
            return (
              <li key={r.id} className="px-3 py-2">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    <span className="w-24 shrink-0 tabular-nums text-stone-600 dark:text-stone-400">{fmt(r.watchedOn)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words">
                        {r.show} <span className="text-stone-500">S{r.season} E{r.episode}</span>
                      </span>
                      <span className="block truncate text-xs text-stone-500">
                        {[r.episodeName, r.format, r.nth > 1 ? `${nth(r.nth)} time` : "", r.fromMemory ? "from memory" : ""].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 rounded px-2 py-1 text-xs text-stone-500 group-open:bg-stone-100 dark:group-open:bg-stone-800">Edit</span>
                  </summary>
                  <div className="mt-2 space-y-2 rounded-lg bg-stone-50 p-3 dark:bg-stone-950">
                    <form action={editTvWatchFormat.bind(null, r.id)} className="space-y-2">
                      <input type="hidden" name="back" value={here} />
                      <div className="flex gap-2">
                        <select name="format_id" defaultValue={r.formatId} className={field} aria-label="Watched on">
                          <FormatOptions formats={formats} />
                        </select>
                        <button type="submit" className="shrink-0 rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-900">Save</button>
                      </div>
                      {same.length > 1 && (
                        <label className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
                          <input type="checkbox" name="also" value={same.filter((x) => x !== r.id).join(",")} defaultChecked className="size-4" />
                          All {same.length} {r.show} episodes on {r.format} in this list
                        </label>
                      )}
                    </form>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <Link href={`/tv/${r.tmdbTvId}`} className="underline">Go to the show</Link>
                      <form action={removeTvWatch.bind(null, r.id)}>
                        <input type="hidden" name="confirm" value="yes" />
                        <input type="hidden" name="back" value={here} />
                        <button type="submit" className="rounded bg-red-700 px-2 py-1 text-white">Delete this watch</button>
                      </form>
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? <Link href={`/watches/tv?page=${page - 1}`} className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">← Newer</Link> : <span />}
          <span className="text-stone-500">Page {page} of {pages}</span>
          {page < pages ? <Link href={`/watches/tv?page=${page + 1}`} className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">Older →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
