import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { after } from "next/server";
import { refreshWatchlistAvailability } from "@/db/streaming";
import { listWatchlist, watchlistStatus, type WatchlistEntry } from "@/db/watchlist";
import { withBase } from "@/lib/base-path";
import { searchMovies, tmdbEnabled } from "@/lib/tmdb";
import { WatchTabs } from "@/components/watch-tabs";
import { addFilm, removeFilm, undoRemove } from "./actions";

export const metadata: Metadata = { title: "Watchlist · SpineFind" };

const VIEWS = { all: "All", tonight: "Watch tonight", shelf: "On your shelf", services: "On your services" } as const;
type View = keyof typeof VIEWS;
const onShelf = (e: WatchlistEntry) => e.owned?.where === "shelf";
const streaming = (e: WatchlistEntry) => (e.services?.length ?? 0) > 0;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const field = "min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm dark:border-stone-700 dark:bg-stone-900";

/** The watchlist: what you want to watch, where you can watch it, and adding or removing films. */
export default async function WatchlistPage({ searchParams }: PageProps<"/watchlist">) {
  const sp = await searchParams;
  const view: View = (Object.keys(VIEWS) as View[]).find((v) => v === sp.view) ?? "all";
  const q = one(sp.add).trim();
  // Streaming changes daily: re-check anything stale after this page is sent.
  after(refreshWatchlistAvailability);
  const [all, results] = await Promise.all([
    listWatchlist(),
    q && tmdbEnabled() ? searchMovies(q).then((r) => r.slice(0, 8)).catch(() => null) : Promise.resolve([]),
  ]);
  const status = results?.length ? await watchlistStatus(results.map((r) => r.tmdbId)) : new Map();
  const filters: Record<View, (e: WatchlistEntry) => boolean> = {
    all: () => true, tonight: (e) => onShelf(e) || streaming(e), shelf: onShelf, services: streaming,
  };
  const shown = all.filter(filters[view]);
  const tab = (active: boolean) =>
    `shrink-0 rounded-md px-3 py-1.5 text-sm ${active ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"}`;
  const added = one(sp.added), removed = one(sp.removed), removedKey = one(sp.key);

  return (
    <main className="mx-auto w-full min-w-0 max-w-2xl flex-1 space-y-4 px-4 py-6">
      <WatchTabs active="watchlist" />
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
          <Link href="/pick?mode=watchlist" className="shrink-0 text-sm text-stone-600 underline dark:text-stone-400">Pick one →</Link>
        </div>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Add and remove films here, or <Link href="/settings#imdb" className="underline">upload your IMDb watchlist</Link> to bring in new ones.
          Films come off once you log a watch.
        </p>
      </header>

      {added && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">Added {added}.</p>}
      {removed && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-stone-100 px-3 py-2 text-sm dark:bg-stone-800">
          <span className="min-w-0 break-words">Removed {removed}.</span>
          {removedKey && (
            <form action={undoRemove.bind(null, removedKey)}>
              <button type="submit" className="shrink-0 rounded-md px-2 py-1 font-medium underline">Undo</button>
            </form>
          )}
        </div>
      )}

      <section className="space-y-2">
        <form action={withBase("/watchlist")} className="flex gap-2">
          <input type="search" name="add" defaultValue={q} placeholder="Add a film, e.g. Paris, Texas" aria-label="Find a film to add" className={field} />
          <button type="submit" className="shrink-0 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-900">Find</button>
        </form>
        {q && (results === null ? (
          <p className="text-sm text-red-700 dark:text-red-300">Couldn&apos;t reach TMDB. Try again in a moment.</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">No films found for &ldquo;{q}&rdquo;.</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {results.map((r) => {
              const s = status.get(r.tmdbId);
              const note = [s?.seen && "you've seen it", s?.owned && "you own it"].filter(Boolean).join(", ");
              return (
                <li key={r.tmdbId} className="flex items-center gap-3 px-3 py-2">
                  <Poster path={r.posterPath} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{r.title}{r.year && <span className="text-stone-500"> ({r.year})</span>}</p>
                    {note && <p className="text-xs text-stone-500">{note[0].toUpperCase() + note.slice(1)}</p>}
                  </div>
                  {s?.listed ? (
                    <span className="shrink-0 text-xs text-emerald-800 dark:text-emerald-300">On your list</span>
                  ) : (
                    <form action={addFilm.bind(null, r.tmdbId, r.title, r.year)}>
                      <button type="submit" className="shrink-0 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs dark:border-stone-700">Add</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
      </section>

      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1" aria-label="Show">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link key={v} href={v === "all" ? "/watchlist" : `/watchlist?view=${v}`} className={tab(view === v)}>
            {VIEWS[v]} ({all.filter(filters[v]).length})
          </Link>
        ))}
      </nav>

      {all.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">
          Your watchlist is empty. Find a film above, or <Link href="/settings#imdb" className="underline">upload your IMDb watchlist</Link>.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">Nothing here right now.</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {shown.map((e) => <Row key={e.filmKey} e={e} view={view} />)}
        </ul>
      )}
      <p className="text-xs text-stone-500">Streaming data from JustWatch.</p>
    </main>
  );
}

function Row({ e, view }: { e: WatchlistEntry; view: View }) {
  const facts = [e.runtime && `${e.runtime} min`, e.genres.slice(0, 2).join(", "), e.score && `TMDB ${e.score.toFixed(1)}`].filter(Boolean).join(" · ");
  const log = `/watches/new?${new URLSearchParams({ title: e.title, tmdb: String(e.tmdbId), ...(e.year ? { year: String(e.year) } : {}), ...(e.services?.[0] ? { service: e.services[0] } : {}) })}`;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Poster path={e.posterPath} />
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
      <div className="flex shrink-0 items-center gap-1">
        <Link href={log} className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs dark:border-stone-700">Watched it</Link>
        <form action={removeFilm}>
          <input type="hidden" name="key" value={e.filmKey} />
          <input type="hidden" name="view" value={view} />
          <button type="submit" aria-label={`Remove ${e.title} from your watchlist`} title="Remove"
            className="flex size-8 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100">✕</button>
        </form>
      </div>
    </li>
  );
}

function Poster({ path }: { path: string | null }) {
  return path ? (
    <Image src={`https://image.tmdb.org/t/p/w92${path}`} alt="" width={36} height={54} className="h-[54px] w-9 shrink-0 rounded-sm object-cover" />
  ) : (
    <span className="h-[54px] w-9 shrink-0 rounded-sm bg-stone-200 dark:bg-stone-700" />
  );
}
