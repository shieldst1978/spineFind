import Link from "next/link";
import { ShelfFilters } from "@/components/shelf-filters";
import { Spine } from "@/components/spine";
import { searchShelf, shelfTotals, type Location, type MediaFormat, type ShelfFilters as Filters } from "@/db/queries";
import { COLOUR_NAMES } from "@/lib/colours";

const FORMATS: MediaFormat[] = ["4K UltraHD", "Blu Ray", "DVD", "HD DVD"];
const LOCATIONS: (Location | "all")[] = ["shelf", "loft", "gone", "all"];

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function ShelfPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const q = one(sp.q);
  const colours = [sp.colour ?? []].flat().filter((c) => COLOUR_NAMES.includes(c));
  const format = FORMATS.find((f) => f === one(sp.format));
  const location = LOCATIONS.find((l) => l === one(sp.location)) ?? "shelf";
  const watchedParam = one(sp.watched);
  const watched: Filters["watched"] = watchedParam === "watched" || watchedParam === "unwatched" ? watchedParam : undefined;
  const added = one(sp.added) === "1";

  const [{ products, total }, totals] = await Promise.all([
    searchShelf({ q, colours, format, location, watched }),
    shelfTotals(),
  ]);
  const filtering = Boolean(q || colours.length || format || watched || location !== "shelf");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shelf</h1>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {totals.products} boxes · {totals.films} films · {totals.watched} watched
          </p>
        </div>
        <Link href="/add" className="shrink-0 rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-900">
          + Add
        </Link>
      </header>

      {added && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Added. Here it is.
        </p>
      )}

      <ShelfFilters q={q} colours={colours} format={format ?? ""} location={location} watched={watched ?? ""} />

      <p className="mt-6 mb-3 text-sm text-stone-600 dark:text-stone-400" aria-live="polite">
        {filtering ? `${total} ${total === 1 ? "box matches" : "boxes match"}` : `${total} boxes on the shelf`}
        {total > products.length && ` (showing the first ${products.length})`}
      </p>

      {products.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">
          Nothing matches. Try fewer colours, or check the loft.
        </p>
      ) : (
        <ul className="space-y-2">
          {products.map((p) => (
            <li key={p.id} className="flex gap-3 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
              <Spine colours={p.spineColours} className="min-h-14" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h2 className="font-medium">{p.title}</h2>
                  <span className="text-xs text-stone-500">{p.spineColours.join(" / ")}</span>
                  {p.location !== "shelf" && (
                    <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      {p.location === "loft" ? "Loft" : "Gone"}
                    </span>
                  )}
                </div>
                <ul className={`mt-1 text-sm ${p.items.length > 1 ? "divide-y divide-stone-100 dark:divide-stone-800" : ""}`}>
                  {p.items.map((it) => (
                    <li key={it.id}>
                      <Link href={`/item/${it.id}`} className="-mx-2 flex min-h-11 items-center gap-2 rounded-md px-2 py-2 hover:bg-stone-100 active:bg-stone-200 dark:hover:bg-stone-800 dark:active:bg-stone-700">
                        <span className="min-w-0 flex-1 truncate">
                          {it.title}
                          {it.year && <span className="text-stone-500"> ({it.year})</span>}
                        </span>
                        <span className="shrink-0 text-xs text-stone-500">{it.format}</span>
                        <WatchedMark watched={it.watched} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function WatchedMark({ watched }: { watched: boolean | null }) {
  if (watched === null) return <span className="w-4 shrink-0 text-center text-xs text-stone-400" title="TV: not tracked">–</span>;
  return watched ? (
    <span className="w-4 shrink-0 text-center text-emerald-600" title="Watched" aria-label="Watched">✓</span>
  ) : (
    <span className="w-4 shrink-0 text-center text-stone-300 dark:text-stone-600" title="Not watched" aria-label="Not watched">○</span>
  );
}
