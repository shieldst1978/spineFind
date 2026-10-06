import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { listReviews, REVIEW_PAGE_SIZE, type ReviewCandidate, type ReviewEntry } from "@/db/queries";
import { withBase } from "@/lib/base-path";
import { searchMovies, tmdbEnabled } from "@/lib/tmdb";
import { confirmMatch, rejectMatch } from "./actions";

export const metadata: Metadata = { title: "Review matches · SpineFind" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const field =
  "min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm dark:border-stone-700 dark:bg-stone-900";

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const sp: SP = await searchParams;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const { entries, total, counts } = await listReviews(page);
  const pages = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));

  // A TMDB search for one entry, shown inside its card.
  const searchFor = one(sp.for);
  const query = one(sp.q).trim();
  const searched = searchFor && query && tmdbEnabled()
    ? (await searchMovies(query).catch(() => [])).slice(0, 8).map<ReviewCandidate>((r) => ({ ...r, via: `search: "${query}"` }))
    : [];

  return (
    <main className="mx-auto w-full min-w-0 max-w-2xl flex-1 space-y-5 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Review matches</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {counts.review} to check · {counts.unmatched} not found · {counts.done} done. Linking a film gives it cast, crew, genres and poster.
          Leaving one unlinked is fine; it just won&apos;t have those details.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">
          All done. Nothing left to review.
        </p>
      ) : (
        <ul className="space-y-4">
          {entries.map((e) => (
            <ReviewCard key={e.matchKey} entry={e} page={page} searched={searchFor === e.matchKey ? searched : null} query={searchFor === e.matchKey ? query : ""} />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? <Link href={`/review?page=${page - 1}`} className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">← Previous</Link> : <span />}
          <span className="text-stone-600 dark:text-stone-400">Page {page} of {pages}</span>
          {page < pages ? <Link href={`/review?page=${page + 1}`} className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">Next →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}

function ReviewCard({ entry: e, page, searched, query }: { entry: ReviewEntry; page: number; searched: ReviewCandidate[] | null; query: string }) {
  const uses = [e.boxes && `${e.boxes} on the shelf`, e.watches && `${e.watches} ${e.watches === 1 ? "watch" : "watches"}`].filter(Boolean).join(" · ");
  const options = searched ?? e.candidates;
  return (
    <li id={e.matchKey} className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-3">
        <h2 className="font-semibold">
          {e.title} <span className="font-normal text-stone-500">({e.year ?? "no year"})</span>
        </h2>
        <p className="text-xs text-stone-500">
          {uses} · {e.status === "unmatched" ? "nothing found automatically" : e.method}
        </p>
      </div>

      {options.length > 0 ? (
        <ul className="space-y-2">
          {options.map((c) => (
            <li key={c.tmdbId} className="flex items-center gap-3">
              {c.posterPath ? (
                <Image src={`https://image.tmdb.org/t/p/w92${c.posterPath}`} alt="" width={36} height={54} className="h-[54px] w-9 shrink-0 rounded-sm object-cover" />
              ) : (
                <span className="h-[54px] w-9 shrink-0 rounded-sm bg-stone-200 dark:bg-stone-700" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {c.title} <span className="text-stone-500">({c.year ?? "?"})</span>
                </p>
                <p className="truncate text-xs text-stone-500">{c.via}</p>
              </div>
              <form action={confirmMatch.bind(null, e.matchKey)} className="flex shrink-0 flex-col items-end gap-1">
                <input type="hidden" name="tmdb_id" value={c.tmdbId} />
                <input type="hidden" name="page" value={page} />
                {e.year && c.year && c.year !== e.year && (
                  <label className="flex items-center gap-1 text-xs text-stone-600 dark:text-stone-400">
                    <input type="checkbox" name="fix_year" value="yes" className="size-4" /> make my year {c.year}
                  </label>
                )}
                <button type="submit" className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-900">
                  This one
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone-600 dark:text-stone-400">{searched ? `Nothing on TMDB for "${query}".` : "No candidates. Try a search below."}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
        <form action={withBase("/review")} className="flex min-w-0 basis-full gap-2 sm:basis-auto sm:flex-1">
          <input type="hidden" name="for" value={e.matchKey} />
          <input type="hidden" name="page" value={page} />
          <input type="search" name="q" defaultValue={query || e.title} aria-label={`Search TMDB for ${e.title}`} className={field} />
          <button type="submit" className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-sm dark:border-stone-700">Search TMDB</button>
        </form>
        <form action={rejectMatch.bind(null, e.matchKey)}>
          <input type="hidden" name="page" value={page} />
          <button type="submit" className="rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800">
            None of these
          </button>
        </form>
      </div>
    </li>
  );
}
