import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { recentShows, seenShows } from "@/db/tv";
import { withBase } from "@/lib/base-path";
import { searchTv, tmdbEnabled } from "@/lib/tmdb";
import { WatchTabs } from "@/components/watch-tabs";

export const metadata: Metadata = { title: "TV · SpineFind" };

const field = "min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm dark:border-stone-700 dark:bg-stone-900";

/** TV: the shows you're watching (with what's next), and a TMDB search to start logging a new one. */
export default async function TvPage({ searchParams }: PageProps<"/tv">) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const [watching, seen, results] = await Promise.all([
    recentShows(),
    seenShows(),
    q && tmdbEnabled() ? searchTv(q).then((r) => r.slice(0, 10)).catch(() => null) : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto w-full min-w-0 max-w-xl flex-1 space-y-5 px-4 py-6">
      <WatchTabs active="tv-log" />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Log TV</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">Find a show, then tick the episodes you watched. Kept apart from your films.</p>
      </header>

      <form action={withBase("/tv")} className="flex gap-2">
        <input type="search" name="q" defaultValue={q} placeholder="Find a show, e.g. Slow Horses" aria-label="Find a TV show" className={field} autoFocus={!watching.length} />
        <button type="submit" className="shrink-0 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-900">Find</button>
      </form>

      {q && (
        results === null ? (
          <p className="text-sm text-red-700 dark:text-red-300">Couldn&apos;t reach TMDB. Try again in a moment.</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">No shows found for &ldquo;{q}&rdquo;.</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {results.map((r) => (
              <li key={r.tmdbTvId}>
                <Link href={`/tv/${r.tmdbTvId}`} className="flex items-center gap-3 px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800">
                  <Poster path={r.posterPath} />
                  <span className="min-w-0 flex-1 break-words text-sm">{r.name}{r.year && <span className="text-stone-500"> ({r.year})</span>}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}

      {watching.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Watching</h2>
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {watching.map((s) => (
              <li key={s.tmdb_tv_id}>
                <Link href={`/tv/${s.tmdb_tv_id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800">
                  <Poster path={s.poster_path} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm">{s.name}</span>
                    <span className="block text-xs text-stone-500">
                      {s.episodes_watched}{s.total ? ` of ${s.total}` : ""} episodes · last {fmt(s.last_watched)}{s.status === "Ended" && s.total && s.episodes_watched >= s.total ? " · finished" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-stone-500">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {seen.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Seen before <span className="text-xs font-normal text-stone-500">· no dates, e.g. from IMDb</span></h2>
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {seen.map((s) => (
              <li key={s.tmdb_tv_id}>
                <Link href={`/tv/${s.tmdb_tv_id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800">
                  <Poster path={s.poster_path} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm">{s.name}</span>
                    <span className="block text-xs text-stone-500">{s.seen}{s.total ? ` of ${s.total}` : ""} episodes seen</span>
                  </span>
                  <span className="shrink-0 text-xs text-stone-500">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Poster({ path }: { path: string | null }) {
  return path ? (
    <Image src={`https://image.tmdb.org/t/p/w92${path}`} alt="" width={32} height={48} className="h-12 w-8 shrink-0 rounded-sm object-cover" />
  ) : (
    <span className="h-12 w-8 shrink-0 rounded-sm bg-stone-200 dark:bg-stone-700" />
  );
}

const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
