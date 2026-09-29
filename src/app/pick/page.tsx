import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { Spine } from "@/components/spine";
import { detailsForItem } from "@/db/films";
import { pickDecades, pickFilms, randomDecade, type MediaFormat, type PickCriteria } from "@/db/queries";
import { COLOUR_NAMES } from "@/lib/colours";

export const metadata: Metadata = { title: "Pick a film · SpineFind" };

const FORMATS: MediaFormat[] = ["4K UltraHD", "Blu Ray", "DVD", "HD DVD"];
const field =
  "w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 py-2 text-base sm:text-sm dark:border-stone-700 dark:bg-stone-900";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PickPage({ searchParams }: PageProps<"/pick">) {
  const sp: SP = await searchParams;
  const modeParam = one(sp.mode);
  const mode: PickCriteria["mode"] = modeParam === "rewatch" || modeParam === "any" ? modeParam : "unwatched";
  const format = FORMATS.find((f) => f === one(sp.format));
  const colour = COLOUR_NAMES.find((c) => c === one(sp.colour));
  const years = Number(one(sp.years)) || undefined;
  const decadeParam = one(sp.decade);
  const exclude = one(sp.not).split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(-30);

  // "Surprise me" picks a decade first, from those with a matching film.
  const randomDecadeWanted = decadeParam === "random";
  const decade = randomDecadeWanted
    ? ((await randomDecade({ mode, format, colour, notSeenYears: years })) ?? undefined)
    : /^\d{4}$/.test(decadeParam) ? Number(decadeParam) : undefined;

  const [{ total, picks }, decades] = await Promise.all([
    pickFilms({ mode, format, decade, colour, notSeenYears: mode === "rewatch" ? years : undefined, exclude }),
    pickDecades({ mode, format, colour }),
  ]);
  // Keep a decade from the URL in the list even if nothing matches it now.
  const chosenDecade = /^\d{4}$/.test(decadeParam) ? Number(decadeParam) : undefined;
  if (chosenDecade !== undefined && !decades.some((d) => d.decade === chosenDecade)) {
    decades.push({ decade: chosenDecade, n: 0 });
    decades.sort((a, b) => b.decade - a.decade);
  }
  const [pick, ...runnersUp] = picks;
  const details = pick ? await detailsForItem(pick) : null;

  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) p.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/pick?${p}`;
  };
  const criteriaKey = [mode, decadeParam, format, colour, years].join("|");
  // "Another" never repeats the pick you just passed on.
  const another = href({ not: [...exclude, pick?.id].filter(Boolean).join(",") });

  return (
    <main className="mx-auto w-full min-w-0 max-w-xl flex-1 space-y-5 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Pick a film</h1>

      {/* Keyed on the criteria so the dropdowns always show what the page is using. */}
      <AutoSubmitForm key={criteriaKey} action="/pick" className="grid grid-cols-2 gap-2">
        <label className="col-span-2 space-y-1">
          <span className="text-sm text-stone-600 dark:text-stone-400">From your shelf</span>
          <select name="mode" defaultValue={mode} className={field}>
            <option value="unwatched">Something I haven&apos;t watched</option>
            <option value="rewatch">A rewatch</option>
            <option value="any">Anything</option>
          </select>
        </label>
        <select name="decade" defaultValue={decadeParam} className={field} aria-label="Decade">
          <option value="">Any decade</option>
          <option value="random">Surprise me (random decade)</option>
          {decades.map((d) => <option key={d.decade} value={d.decade}>{d.decade}s ({d.n})</option>)}
        </select>
        <select name="format" defaultValue={format ?? ""} className={field} aria-label="Format">
          <option value="">Any format</option>
          {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select name="colour" defaultValue={colour ?? ""} className={field} aria-label="Spine colour">
          <option value="">Any spine colour</option>
          {COLOUR_NAMES.map((c) => <option key={c} value={c}>{c} spine</option>)}
        </select>
        {mode === "rewatch" ? (
          <select name="years" defaultValue={years ? String(years) : ""} className={field} aria-label="Not seen for">
            <option value="">Any time since</option>
            {[1, 2, 3, 5, 10].map((y) => <option key={y} value={y}>Not seen in {y}+ {y === 1 ? "year" : "years"}</option>)}
          </select>
        ) : (
          <span />
        )}
      </AutoSubmitForm>

      {!pick ? (
        <div className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">
          <p>Nothing on the shelf matches{exclude.length ? " that you haven't already passed on" : ""}.</p>
          <p className="mt-2 text-sm">
            {exclude.length ? <Link href={href({ not: undefined })} className="underline">Start again</Link> : "Try loosening a criterion."}
          </p>
        </div>
      ) : (
        <>
          <article className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
            <div className="flex gap-4 p-4">
              {details?.posterPath ? (
                <Image src={`https://image.tmdb.org/t/p/w185${details.posterPath}`} alt={`${pick.title} poster`} width={96} height={144}
                  className="h-36 w-24 shrink-0 rounded-md object-cover shadow" priority />
              ) : (
                <Spine colours={pick.spineColours} className="h-36 !w-10" />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-xl font-semibold leading-tight">
                  {pick.title}
                  {pick.year && <span className="font-normal text-stone-500"> ({pick.year})</span>}
                </h2>
                {details && (
                  <p className="text-sm text-stone-600 dark:text-stone-400">
                    {[details.directors?.length ? details.directors.join(", ") : null,
                      details.runtimeMinutes ? runtime(details.runtimeMinutes) : null]
                      .filter(Boolean).join(" · ")}
                  </p>
                )}
                {details?.genres?.length ? <p className="text-xs text-stone-500">{details.genres.join(", ")}</p> : null}
                <p className="pt-1 text-sm">
                  {pick.times === 0
                    ? "Never watched"
                    : `Watched ${pick.times === 1 ? "once" : `${pick.times} times`}, last on ${fmtDate(pick.lastWatched!)}`}
                </p>
                {randomDecadeWanted && decade !== undefined && (
                  <p className="text-xs text-stone-500">
                    Surprise decade: <strong>{decade}s</strong> ·{" "}
                    <Link href={href({ decade: String(decade), not: undefined })} className="underline">stick with the {decade}s</Link>
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 border-t border-stone-200 bg-stone-50 px-4 py-3 dark:border-stone-800 dark:bg-stone-950">
              <Spine colours={pick.spineColours} className="h-10 !w-5" />
              <p className="min-w-0 flex-1 text-sm">
                Look for {/^[AEIOU]/.test(pick.spineColours[0] ?? "") ? "an" : "a"} <strong>{pick.spineColours.join(" / ")}</strong> spine
                {pick.box !== pick.title && <> labelled <em>{pick.box}</em></>}
                <span className="text-stone-500"> · {pick.format}</span>
              </p>
            </div>
          </article>

          <div className="flex gap-3">
            <Link href={`/item/${pick.id}`} className="flex-1 rounded-lg bg-stone-900 px-4 py-3 text-center font-medium text-white dark:bg-stone-100 dark:text-stone-900">
              Watch this
            </Link>
            <Link href={another} className="flex-1 rounded-lg border border-stone-300 px-4 py-3 text-center font-medium dark:border-stone-700">
              Another ↻
            </Link>
          </div>
          <p className="text-center text-xs text-stone-500">
            1 of {total.toLocaleString("en-GB")} {total === 1 ? "match" : "matches"}
            {exclude.length > 0 && <> · <Link href={href({ not: undefined })} className="underline">reset</Link></>}
          </p>

          {runnersUp.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-stone-600 dark:text-stone-400">Or maybe</h2>
              <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
                {runnersUp.map((r) => (
                  <li key={r.id}>
                    <Link href={`/item/${r.id}`} className="flex min-h-11 items-center gap-3 px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">
                      <Spine colours={r.spineColours} className="h-8 !w-4" />
                      <span className="min-w-0 flex-1 truncate">
                        {r.title}
                        {r.year && <span className="text-stone-500"> ({r.year})</span>}
                      </span>
                      <span className="shrink-0 text-xs text-stone-500">{r.format}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function runtime(min: number) {
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}

function fmtDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
