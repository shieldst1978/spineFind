import type { Metadata } from "next";
import Link from "next/link";
import { tvLog, TV_LOG_PAGE } from "@/db/tv";
import { WatchTabs } from "@/components/watch-tabs";
import { removeTvWatch } from "@/app/tv/actions";

export const metadata: Metadata = { title: "TV log · SpineFind" };

const nth = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Every TV episode logged, newest first. Kept apart from the film log. */
export default async function TvLogPage({ searchParams }: PageProps<"/watches/tv">) {
  const sp = await searchParams;
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  const { rows, total } = await tvLog(page);
  const pages = Math.max(1, Math.ceil(total / TV_LOG_PAGE));
  const here = page > 1 ? `/watches/tv?page=${page}` : "/watches/tv";

  return (
    <main className="mx-auto w-full min-w-0 max-w-2xl flex-1 space-y-4 px-4 py-6">
      <WatchTabs active="tv" />
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">TV log</h1>
        <span className="text-sm text-stone-500">{total.toLocaleString("en-GB")} episodes</span>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">
          No TV logged yet. <Link href="/tv" className="underline">Log an episode</Link>
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white text-sm dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-24 shrink-0 tabular-nums text-stone-600 dark:text-stone-400">{fmt(r.watchedOn)}</span>
              <span className="min-w-0 flex-1">
                <Link href={`/tv/${r.tmdbTvId}`} className="block break-words hover:underline">
                  {r.show} <span className="text-stone-500">S{r.season} E{r.episode}</span>
                </Link>
                <span className="block truncate text-xs text-stone-500">
                  {[r.episodeName, r.format, r.nth > 1 ? `${nth(r.nth)} time` : "", r.fromMemory ? "from memory" : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
              <details className="shrink-0">
                <summary className="cursor-pointer list-none rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800">Delete</summary>
                <form action={removeTvWatch.bind(null, r.id)} className="mt-1">
                  <input type="hidden" name="confirm" value="yes" />
                  <input type="hidden" name="back" value={here} />
                  <button type="submit" className="rounded bg-red-700 px-2 py-1 text-xs text-white">Really delete</button>
                </form>
              </details>
            </li>
          ))}
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
