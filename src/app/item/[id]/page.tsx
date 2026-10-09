import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Spine } from "@/components/spine";
import { filmInfo, getItem, listViewingFormats, watchesFor, type FilmInfo } from "@/db/queries";
import { DISC_TO_MEDIA } from "@/db/seed-formats";
import { availabilityFor, type FilmAvailability } from "@/db/streaming";
import { normaliseTitle } from "@/lib/match-key";
import type { Offer } from "@/lib/tmdb";
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

  const [history, formats, info, where] = await Promise.all([
    watchesFor(item.filmKey),
    listViewingFormats(),
    item.tmdbId ? filmInfo(item.tmdbId) : null,
    item.tmdbId && item.itemType === "film" ? availabilityFor(item.tmdbId) : null,
  ]);
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

      {info && <AboutFilm info={info} title={item.title} />}
      {where && <WhereToWatch where={where} />}

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

/** TMDB details: who made it, who's in it, and the other titles it goes by. */
function AboutFilm({ info, title }: { info: FilmInfo; title: string }) {
  // Other titles, skipping yours and repeats (UK first, then TMDB's own, original, US …).
  const seen = new Set([normaliseTitle(title)]);
  const aka = info.titles.filter((t) => !seen.has(normaliseTitle(t.title)) && seen.add(normaliseTitle(t.title))).slice(0, 4);
  const facts = [
    info.ukCertificate,
    info.runtimeMinutes && `${info.runtimeMinutes} min`,
    info.ukReleaseDate && `UK release ${formatDate(info.ukReleaseDate)}`,
  ].filter(Boolean);
  return (
    <section className="flex gap-3 rounded-lg border border-stone-200 bg-white p-4 text-sm dark:border-stone-800 dark:bg-stone-900">
      {info.posterPath && (
        <Image src={`https://image.tmdb.org/t/p/w185${info.posterPath}`} alt="" width={72} height={108}
          className="h-[108px] w-[72px] shrink-0 rounded object-cover" />
      )}
      <div className="min-w-0 space-y-1.5">
        {info.directors.length > 0 && <p><span className="text-stone-500">Directed by</span> {info.directors.join(", ")}</p>}
        {info.cast.length > 0 && <p><span className="text-stone-500">With</span> {info.cast.map((c) => c.name).join(", ")}</p>}
        {(info.genres.length > 0 || facts.length > 0) && (
          <p className="text-stone-600 dark:text-stone-400">{[...info.genres, ...facts].join(" · ")}</p>
        )}
        {info.collectionName && <p className="text-stone-600 dark:text-stone-400">Part of {info.collectionName}</p>}
        {aka.length > 0 && (
          <p className="text-stone-600 dark:text-stone-400">
            Also known as{" "}
            {aka.map((t, i) => (
              <span key={t.title}>{i > 0 && ", "}<em>{t.title}</em>{t.country && t.kind === "alternative" && ` (${t.country === "GB" ? "UK" : t.country})`}</span>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}

/** UK streaming, free, rent and buy options, with your own services first. */
function WhereToWatch({ where }: { where: FilmAvailability }) {
  const yours = [...where.stream, ...where.free, ...where.ads].filter((o) => where.mine.has(o.providerId));
  const otherStream = where.stream.filter((o) => !where.mine.has(o.providerId));
  const free = [...where.free, ...where.ads].filter((o) => !where.mine.has(o.providerId));
  const rentBuy = [...new Map([...where.rent, ...where.buy].map((o) => [o.providerId, o])).values()];
  const nothing = !yours.length && !otherStream.length && !free.length && !rentBuy.length;
  return (
    <section className="space-y-2 rounded-lg border border-stone-200 bg-white p-4 text-sm dark:border-stone-800 dark:bg-stone-900">
      <h2 className="font-medium">Where to watch in the UK</h2>
      {nothing ? (
        <p className="text-stone-600 dark:text-stone-400">Not streaming, to rent or to buy anywhere in the UK right now.</p>
      ) : (
        <>
          {yours.length > 0 ? (
            <OfferLine label="On your services" offers={yours} strong />
          ) : (
            <p className="text-stone-600 dark:text-stone-400">
              Not on your services.{where.mine.size === 0 && <> <Link href="/settings" className="underline">Tick the ones you have</Link>.</>}
            </p>
          )}
          {otherStream.length > 0 && <OfferLine label="Also streaming on" offers={otherStream} />}
          {free.length > 0 && <OfferLine label="Free" offers={free} />}
          {rentBuy.length > 0 && <OfferLine label="Rent or buy" offers={rentBuy} />}
        </>
      )}
      <p className="text-xs text-stone-500">Streaming data from JustWatch.</p>
    </section>
  );
}

function OfferLine({ label, offers, strong }: { label: string; offers: Offer[]; strong?: boolean }) {
  return (
    <div className="space-y-1">
      <p className={strong ? "font-medium text-emerald-800 dark:text-emerald-300" : "text-stone-500"}>{label}</p>
      <ul className="flex flex-wrap gap-1.5">
        {offers.map((o) => (
          <li key={o.providerId} className="flex items-center gap-1.5 rounded-md border border-stone-200 py-0.5 pl-0.5 pr-2 text-xs dark:border-stone-700">
            {o.logoPath && <Image src={`https://image.tmdb.org/t/p/w92${o.logoPath}`} alt="" width={20} height={20} className="size-5 rounded" />}
            {o.name}
          </li>
        ))}
      </ul>
    </div>
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
