import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { after } from "next/server";
import { refreshWatchlistAvailability } from "@/db/streaming";
import { listWatchlist, type WatchlistEntry } from "@/db/watchlist";

export const metadata: Metadata = { title: "Watchlist · SpineFind" };

const VIEWS = { all: "All", tonight: "Watch tonight", shelf: "On your shelf", services: "On your services" } as const;
type View = keyof typeof VIEWS;
const onShelf = (e: WatchlistEntry) => e.owned?.where === "shelf";
const streaming = (e: WatchlistEntry) => (e.services?.length ?? 0) > 0;

export default async function WatchlistPage({ searchParams }: PageProps<"/watchlist">) {
  const sp = await searchParams;
  const view: View = (Object.keys(VIEWS) as View[]).find((v) => v === sp.view) ?? "all";
  // Streaming changes daily: re-check anything stale after this page is sent.
  after(refreshWatchlistAvailability);
  const all = await listWatchlist();
  const filters: Record<View, (e: WatchlistEntry) => boolean> = {
    all: () => true, tonight: (e) => onShelf(e) || streaming(e), shelf: onShelf, services: streaming,
  };
  const shown = all.filter(filters[view]);
  const tab = (active: boolean) =>
    `shrink-0 rounded-md px-3 py-1.5 text-sm ${active ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"}`;

  return (
    <main className="mx-auto w-full min-w-0 max-w-2xl flex-1 space-y-4 px-4 py-6">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
          <Link href="/pick?from=watchlist" className="shrink-0 text-sm text-stone-600 underline dark:text-stone-400">Pick one →</Link>
        </div>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          From your IMDb watchlist (<Link href="/settings#watchlist" className="underline">upload a new export</Link> to update it).
          Films come off once you log a watch.
        </p>
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1" aria-label="Show">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <Link key={v} href={v === "all" ? "/watchlist" : `/watchlist?view=${v}`} className={tab(view === v)}>
              {VIEWS[v]} ({all.filter(filters[v]).length})
            </Link>
          ))}
        </nav>
      </header>

      {all.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">
          Your watchlist is empty. <Link href="/settings#watchlist" className="underline">Upload your IMDb watchlist</Link> to fill it.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">Nothing here right now.</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {shown.map((e) => <Row key={e.filmKey} e={e} />)}
        </ul>
      )}
      <p className="text-xs text-stone-500">Streaming data from JustWatch.</p>
    </main>
  );
}

function Row({ e }: { e: WatchlistEntry }) {
  const facts = [e.runtime && `${e.runtime} min`, e.genres.slice(0, 2).join(", "), e.score && `TMDB ${e.score.toFixed(1)}`].filter(Boolean).join(" · ");
  const log = `/watches/new?${new URLSearchParams({ title: e.title, tmdb: String(e.tmdbId), ...(e.year ? { year: String(e.year) } : {}), ...(e.services?.[0] ? { service: e.services[0] } : {}) })}`;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      {e.posterPath ? (
        <Image src={`https://image.tmdb.org/t/p/w92${e.posterPath}`} alt="" width={36} height={54} className="h-[54px] w-9 shrink-0 rounded-sm object-cover" />
      ) : (
        <span className="h-[54px] w-9 shrink-0 rounded-sm bg-stone-200 dark:bg-stone-700" />
      )}
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm">{e.title}{e.year && <span className="text-stone-500"> ({e.year})</span>}</p>
        {facts && <p className="truncate text-xs text-stone-500">{facts}</p>}
        <p className="text-xs">
          {e.owned ? (
            <Link href={`/item/${e.owned.itemId}`} className="text-emerald-800 underline dark:text-emerald-300">
              {e.owned.where === "shelf" ? "On your shelf" : "In the loft"}: {e.owned.box}, {e.owned.spine}
            </Link>
          ) : e.services === null ? (
            <span className="text-stone-500">Checking streaming…</span>
          ) : e.services.length ? (
            <span className="text-sky-800 dark:text-sky-300">On {e.services.join(", ")}</span>
          ) : (
            <span className="text-stone-500">{e.rentable ? "Not on your services; rent or buy" : "Not available to stream"}</span>
          )}
        </p>
      </div>
      <Link href={log} className="shrink-0 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs dark:border-stone-700">Watched it</Link>
    </li>
  );
}
