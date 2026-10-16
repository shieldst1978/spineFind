import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { Spine } from "@/components/spine";
import { markSeenBefore } from "./actions";

export const metadata: Metadata = { title: "Seen before? · SpineFind" };

const PAGE_SIZE = 30;

type Row = {
  film_key: string; title: string; release_year: number | null; owned_where: string; box_title: string;
  spine_colours: string; poster_path: string | null; vote_count: number | null; total: number;
};

export default async function SeenPage({ searchParams }: PageProps<"/seen">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const where = one(sp.where) === "shelf" || one(sp.where) === "loft" ? one(sp.where) : "";
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const saved = Number(one(sp.saved)) || 0;

  // Films you own with no watch in the log and not already marked seen. Best known first:
  // those are the likeliest to have been seen before the log began.
  const rows = (await db.execute<Row>(sql`
    select a.film_key, a.title, a.release_year, a.owned_where, a.box_title, a.spine_colours, f.poster_path, a.vote_count,
      count(*) over ()::int as total
    from assistant_films a left join films f on f.tmdb_id = a.tmdb_id
    where a.owned and not a.watched ${where ? sql`and a.owned_where = ${where}` : sql``}
    order by a.vote_count desc nulls last, lower(a.title)
    limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`)).rows;
  const total = rows[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (patch: Record<string, string>) => `/seen?${new URLSearchParams({ ...(where ? { where } : {}), ...patch })}`;
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${active ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"}`;

  return (
    <main className="mx-auto w-full min-w-0 max-w-2xl flex-1 space-y-4 px-4 py-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Seen before?</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Films you own with no watch in your log. Your log starts in 2009, so tick any you saw before then (or just never logged).
          This marks the film as seen, not your disc: Pick, Stats and Ask will count it, and the shelf&apos;s ✓ stays for discs
          you&apos;ve actually watched. You can undo one from its film page.
        </p>
        <nav className="flex gap-1" aria-label="Where">
          <Link href="/seen" className={tab(!where)}>All</Link>
          <Link href="/seen?where=shelf" className={tab(where === "shelf")}>On the shelf</Link>
          <Link href="/seen?where=loft" className={tab(where === "loft")}>In the loft</Link>
        </nav>
      </header>

      {saved > 0 && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Marked {saved} {saved === 1 ? "film" : "films"} as seen. Here are the next ones.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">
          Nothing left: every film you own has a watch or is marked seen.
        </p>
      ) : (
        <form action={markSeenBefore} className="space-y-3">
          {where && <input type="hidden" name="where" value={where} />}
          <input type="hidden" name="page" value={page} />
          <p className="text-sm text-stone-600 dark:text-stone-400">{total.toLocaleString("en-GB")} films · page {page} of {pages}</p>
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {rows.map((r) => (
              <li key={r.film_key}>
                <label className="flex min-h-14 items-center gap-3 px-3 py-2">
                  <input type="checkbox" name="film" value={r.film_key} className="size-5 shrink-0" />
                  {r.poster_path ? (
                    <Image src={`https://image.tmdb.org/t/p/w92${r.poster_path}`} alt="" width={28} height={42} className="h-[42px] w-7 shrink-0 rounded-sm object-cover" />
                  ) : (
                    <Spine colours={r.spine_colours.split(" / ")} className="h-[42px] !w-3 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm">
                      {r.title}{r.release_year && <span className="text-stone-500"> ({r.release_year})</span>}
                    </span>
                    <span className="block truncate text-xs text-stone-500">
                      {r.box_title !== r.title ? `${r.box_title} · ` : ""}{r.spine_colours}{r.owned_where === "loft" ? " · loft" : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="sticky bottom-0 flex items-center gap-3 bg-[var(--background)] py-2">
            <button type="submit" className="flex-1 rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white dark:bg-stone-100 dark:text-stone-900">
              Save ticked as seen
            </button>
            {page < pages && (
              <Link href={href({ page: String(page + 1) })} className="shrink-0 rounded-lg border border-stone-300 px-3 py-2.5 text-sm dark:border-stone-700">
                Skip page →
              </Link>
            )}
          </div>
        </form>
      )}
    </main>
  );
}
