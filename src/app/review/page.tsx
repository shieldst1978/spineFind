import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { listDecisions, listReviews, REVIEW_PAGE_SIZE, type ReviewCandidate, type ReviewDecision, type ReviewEntry } from "@/db/queries";
import { withBase } from "@/lib/base-path";
import { normaliseTitle } from "@/lib/match-key";
import { getMovie, searchMovies, tmdbEnabled } from "@/lib/tmdb";
import { confirmMatch, markAsTv, rejectMatch, reopenMatch } from "./actions";

export const metadata: Metadata = { title: "Review matches · SpineFind" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const field =
  "min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm dark:border-stone-700 dark:bg-stone-900";
const tab = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm ${active ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"}`;

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const sp: SP = await searchParams;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const matchedView = one(sp.view) === "matched";
  const { entries, total, counts } = await listReviews(matchedView ? 1 : page);

  return (
    <main className="mx-auto w-full min-w-0 max-w-2xl flex-1 space-y-5 px-4 py-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Review matches</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {counts.review} to check · {counts.unmatched} not found · {counts.done} decided. Linking a film gives it cast, crew, genres and poster.
          Leaving one unlinked is fine; it just won&apos;t have those details.
        </p>
        <nav className="flex gap-1" aria-label="Review views">
          <Link href="/review" className={tab(!matchedView)} aria-current={!matchedView ? "page" : undefined}>To review</Link>
          <Link href="/review?view=matched" className={tab(matchedView)} aria-current={matchedView ? "page" : undefined}>Matched</Link>
        </nav>
      </header>

      {matchedView ? <MatchedList sp={sp} page={page} /> : (
        <>
          <ToReview sp={sp} page={page} entries={entries} />
          <Pager page={page} pages={Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE))} href={(n) => `/review?page=${n}`} />
        </>
      )}
    </main>
  );
}

async function ToReview({ sp, page, entries }: { sp: SP; page: number; entries: ReviewEntry[] }) {
  // A TMDB search for one entry, shown inside its card.
  const searchFor = one(sp.for);
  const query = one(sp.q).trim();
  const searched = searchFor && query && tmdbEnabled() ? await tmdbSearch(query) : [];
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">
        All done. Nothing left to review.
      </p>
    );
  }
  return (
    <ul className="space-y-4">
      {entries.map((e) => (
        <ReviewCard key={e.matchKey} entry={e} page={page} searched={searchFor === e.matchKey ? searched : null} query={searchFor === e.matchKey ? query : ""} />
      ))}
    </ul>
  );
}

/**
 * The card's TMDB search. A pasted TMDB link (or #id) picks that film directly;
 * otherwise exact title matches come first, since TMDB ranks by popularity
 * ("Back to Back" comes 15th, behind every Back to the Future).
 */
async function tmdbSearch(query: string): Promise<ReviewCandidate[]> {
  const id = query.match(/themoviedb\.org\/movie\/(\d+)/)?.[1] ?? query.match(/^#\s*(\d{1,9})$/)?.[1];
  if (id) {
    const m = await getMovie(Number(id)).catch(() => null);
    return m ? [{ tmdbId: m.tmdbId, title: m.title, year: m.releaseDate ? Number(m.releaseDate.slice(0, 4)) : null, posterPath: m.posterPath, via: "from your TMDB link" }] : [];
  }
  const want = normaliseTitle(query);
  const results = await searchMovies(query).catch(() => []);
  return results
    .map((r, i) => ({ r, i, exact: normaliseTitle(r.title) === want }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.i - b.i)
    .slice(0, 12)
    .map(({ r, exact }) => ({ tmdbId: r.tmdbId, title: r.title, year: r.year, posterPath: r.posterPath, via: exact ? "same title" : `search: "${query}"` }));
}

/** Every settled match, newest decision first, so a wrong one can be reopened. */
async function MatchedList({ sp, page }: { sp: SP; page: number }) {
  const q = one(sp.q).trim();
  const { decisions, total } = await listDecisions(page, q);
  const pages = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));
  return (
    <>
      <form action={withBase("/review")} className="flex gap-2">
        <input type="hidden" name="view" value="matched" />
        <input type="search" name="q" defaultValue={q} placeholder="Find a film" aria-label="Find a matched film" className={field} />
        <button type="submit" className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-sm dark:border-stone-700">Find</button>
      </form>
      {decisions.length === 0 ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">{q ? `Nothing matched for "${q}".` : "No matches yet."}</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {decisions.map((d) => <DecisionRow key={d.matchKey} d={d} />)}
        </ul>
      )}
      <Pager page={page} pages={pages} href={(n) => `/review?${new URLSearchParams({ view: "matched", page: String(n), ...(q ? { q } : {}) })}`} />
    </>
  );
}

function DecisionRow({ d }: { d: ReviewDecision }) {
  const how = d.status === "auto" ? "automatic" : d.method === "TV, not a film" ? "TV, not a film" : d.status === "rejected" ? "none of these" : "yours";
  return (
    <li className="flex items-center gap-3 p-3">
      {d.linked?.posterPath ? (
        <Image src={`https://image.tmdb.org/t/p/w92${d.linked.posterPath}`} alt="" width={36} height={54} className="h-[54px] w-9 shrink-0 rounded-sm object-cover" />
      ) : (
        <span className="h-[54px] w-9 shrink-0 rounded-sm bg-stone-200 dark:bg-stone-700" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words">{d.title} <span className="font-normal text-stone-500">({d.year ?? "no year"})</span></p>
        <p className="text-xs break-words text-stone-500">
          {d.linked ? <>→ {d.linked.title} ({d.linked.year ?? "?"})</> : "not linked"} · {how}
        </p>
      </div>
      <form action={reopenMatch.bind(null, d.matchKey)}>
        <button type="submit" className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-sm dark:border-stone-700">Change</button>
      </form>
    </li>
  );
}

function Pager({ page, pages, href }: { page: number; pages: number; href: (n: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-between text-sm" aria-label="Pages">
      {page > 1 ? <Link href={href(page - 1)} className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">← Previous</Link> : <span />}
      <span className="text-stone-600 dark:text-stone-400">Page {page} of {pages}</span>
      {page < pages ? <Link href={href(page + 1)} className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">Next →</Link> : <span />}
    </nav>
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
                <p className="text-sm break-words">
                  {c.title} <span className="text-stone-500">({c.year ?? "?"})</span>
                </p>
                <p className="text-xs break-words text-stone-500">{c.via}</p>
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
        <p className="text-sm text-stone-600 dark:text-stone-400">{searched ? `Nothing on TMDB for "${query}".` : "No candidates. Search below, or paste the film's TMDB link."}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
        <form action={withBase("/review")} className="flex min-w-0 basis-full gap-2 sm:basis-auto sm:flex-1">
          <input type="hidden" name="for" value={e.matchKey} />
          <input type="hidden" name="page" value={page} />
          <input type="search" name="q" defaultValue={query || e.title} aria-label={`Search TMDB for ${e.title}`} className={field} />
          <button type="submit" className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-sm dark:border-stone-700">Search TMDB</button>
        </form>
        <form action={markAsTv.bind(null, e.matchKey)}>
          <input type="hidden" name="page" value={page} />
          <button type="submit" className="rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800">
            TV, not a film
          </button>
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
