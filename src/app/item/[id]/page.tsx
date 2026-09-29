import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Spine } from "@/components/spine";
import { getItem, listViewingFormats, watchesFor } from "@/db/queries";
import { DISC_TO_MEDIA } from "@/db/seed-formats";
import { logWatch, setSeenBefore } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-900";
const ERRORS: Record<string, string> = {
  date: "That date doesn't look right. It can't be in the future.",
  format: "Choose where you watched it.",
  film: "Watches can only be logged for films.",
};

export async function generateMetadata({ params }: PageProps<"/item/[id]">): Promise<Metadata> {
  const { id } = await params;
  const item = UUID.test(id) ? await getItem(id) : null;
  return { title: item ? `${item.title} · SpineFind` : "SpineFind" };
}

export default async function ItemPage({ params, searchParams }: PageProps<"/item/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const item = await getItem(id);
  if (!item) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const [history, formats] = await Promise.all([watchesFor(item.matchKey), listViewingFormats()]);
  const isFilm = item.itemType === "film";
  const discWatches = history.filter((w) => w.kind === "disc");
  // Default to the disc format matching this copy (4K UltraHD -> 4K Blu Ray).
  const copyFormat = Object.entries(DISC_TO_MEDIA).find(([, media]) => media === item.format)?.[0];
  const defaultFormatId = formats.find((f) => f.name === copyFormat)?.id ?? formats[0]?.id;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const error = ERRORS[one(sp.error)];
  const logged = one(sp.logged);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-6 px-4 py-6">
      <header>
        <Link href={`/?q=${encodeURIComponent(item.box.title)}`} className="text-sm text-stone-600 hover:underline dark:text-stone-400">
          ← Shelf
        </Link>
        <div className="mt-2 flex gap-3">
          <Spine colours={item.box.spineColours} className="min-h-20" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {item.title}
              {item.releaseYear && <span className="font-normal text-stone-500"> ({item.releaseYear})</span>}
            </h1>
            <p className="text-sm text-stone-600 dark:text-stone-400">
              {item.format}
              {item.box.title !== item.title && <> · in <em>{item.box.title}</em></>}
              {" · "}
              {{ shelf: "on the shelf", loft: "in the loft", gone: "gone" }[item.box.location]}
              {" · "}
              <Link href={`/box/${item.box.id}`} className="underline">Edit box</Link>
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <Status item={item} discWatches={discWatches.length} lastDisc={discWatches[0]?.watchedOn} />
      </section>

      {(logged || sp.updated || sp.deleted) && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {logged ? `Logged a watch on ${formatDate(logged)}.` : sp.updated ? "Saved your changes to the watch." : "Watch deleted."}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>
      )}

      {isFilm && (
        <section className="space-y-3">
          <h2 className="font-medium">Log a watch</h2>
          <form action={logWatch.bind(null, item.id)} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-sm text-stone-600 dark:text-stone-400">Date</span>
                <input type="date" name="watched_on" defaultValue={today} max={today} className={field} />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-stone-600 dark:text-stone-400">Watched on</span>
                <select name="format_id" defaultValue={defaultFormatId} className={field}>
                  {formats.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <button type="submit" className="w-full rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white dark:bg-stone-100 dark:text-stone-900">
              I watched this
            </button>
            <p className="text-xs text-stone-500">Only disc formats (Blu Ray, 4K Blu Ray, DVD, HD DVD) mark this copy as watched. Other formats still go in your watch log.</p>
          </form>

          {discWatches.length === 0 && (
            <form action={setSeenBefore.bind(null, item.id, !item.watchedBeforeLogging)}>
              <button type="submit" className="w-full rounded-lg border border-stone-300 px-4 py-2 text-sm dark:border-stone-700">
                {item.watchedBeforeLogging ? "Undo “seen before, no date”" : "Seen before, no date to log"}
              </button>
            </form>
          )}
        </section>
      )}

      {isFilm && (
        <section className="space-y-2">
          <h2 className="font-medium">Watch history ({history.length})</h2>
          {history.length === 0 ? (
            <p className="text-sm text-stone-600 dark:text-stone-400">No watches of this film in your log yet.</p>
          ) : (
            <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white text-sm dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
              {history.map((w) => (
                <li key={w.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-28 shrink-0 tabular-nums">{formatDate(w.watchedOn)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {w.format}
                    {w.kind === "disc" && <span className="ml-1.5 text-xs text-emerald-700 dark:text-emerald-400">disc</span>}
                    {w.fromMemory && <span className="ml-1.5 text-xs text-stone-500" title="aNote didn't record the format">from memory</span>}
                  </span>
                  <Link href={`/watches/${w.id}?back=${encodeURIComponent(`/item/${item.id}`)}`}
                    className="rounded px-2 py-1.5 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                    aria-label={`Edit watch on ${formatDate(w.watchedOn)}`}>
                    Edit
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

function Status({ item, discWatches, lastDisc }: { item: Awaited<ReturnType<typeof getItem>> & object; discWatches: number; lastDisc?: string }) {
  if (item.watched === null) {
    return <p className="text-stone-600 dark:text-stone-400">TV: watched status isn&apos;t tracked yet.</p>;
  }
  if (!item.watched) return <p><span className="text-stone-400">○</span> Not watched yet</p>;
  return (
    <p>
      <span className="text-emerald-600">✓</span> Watched
      <span className="text-stone-600 dark:text-stone-400">
        {discWatches > 0
          ? ` · ${discWatches} disc ${discWatches === 1 ? "watch" : "watches"}, last on ${formatDate(lastDisc!)}`
          : " · seen before logging (no date)"}
      </span>
    </p>
  );
}

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
