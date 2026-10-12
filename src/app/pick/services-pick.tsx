import Image from "next/image";
import Link from "next/link";
import { after } from "next/server";
import { pickOnServices, refreshLogAvailability, type ServiceCriteria, type ServicePick } from "@/db/streaming";
import { seenItBefore } from "./actions";

/** Pick on your streaming services: the result card, the runners-up and "Seen it before". */
export async function ServicesPick({ criteria, href }: { criteria: ServiceCriteria; href: (patch: Record<string, string | undefined>) => string }) {
  // Rewatches use the daily availability check of your watch log; top it up after this response.
  if (criteria.mode === "rewatch") after(refreshLogAvailability);
  const { total, picks, checking } = await pickOnServices(criteria);
  const [pick, ...runnersUp] = picks;

  if (!pick) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">
        {total === 0 && !checking && !criteria.exclude?.length ? (
          <p>Nothing on your services matches. <Link href="/settings" className="underline">Check which services are ticked</Link>, or loosen a criterion.</p>
        ) : checking ? (
          <p>Still checking which of your past watches are on your services. Try again in a minute or two.</p>
        ) : (
          <p>Nothing more that you haven&apos;t passed on. <Link href={href({ not: undefined })} className="underline">Start again</Link></p>
        )}
      </div>
    );
  }

  const another = href({ not: [...(criteria.exclude ?? []), pick.tmdbId].join(",") });
  const log = `/watches/new?${new URLSearchParams({ title: pick.title, tmdb: String(pick.tmdbId), ...(pick.year ? { year: String(pick.year) } : {}), ...(pick.services[0] ? { service: pick.services[0] } : {}) })}`;

  return (
    <>
      <article className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="flex gap-4 p-4">
          {pick.posterPath ? (
            <Image src={`https://image.tmdb.org/t/p/w185${pick.posterPath}`} alt={`${pick.title} poster`} width={96} height={144}
              className="h-36 w-24 shrink-0 rounded-md object-cover shadow" priority />
          ) : (
            <span className="h-36 w-24 shrink-0 rounded-md bg-stone-200 dark:bg-stone-700" />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-xl font-semibold leading-tight">
              {pick.title}
              {pick.year && <span className="font-normal text-stone-500"> ({pick.year})</span>}
            </h2>
            <p className="text-sm">{watchedLine(pick)}</p>
            {pick.owned && (
              <p className="text-xs text-stone-500">
                You own it ({pick.owned.location === "loft" ? "in the loft" : "on the shelf"}) · <Link href={`/item/${pick.owned.itemId}`} className="underline">film page</Link>
              </p>
            )}
          </div>
        </div>
        <div className="border-t border-stone-200 bg-stone-50 px-4 py-3 text-sm dark:border-stone-800 dark:bg-stone-950">
          {pick.services.length ? <>On <strong>{pick.services.join(", ")}</strong></> : "On one of your services"}
        </div>
      </article>

      <div className="flex gap-3">
        <Link href={log} className="flex-1 rounded-lg bg-stone-900 px-4 py-3 text-center font-medium text-white dark:bg-stone-100 dark:text-stone-900">
          Log a watch
        </Link>
        <Link href={another} className="flex-1 rounded-lg border border-stone-300 px-4 py-3 text-center font-medium dark:border-stone-700">
          Another ↻
        </Link>
      </div>
      {criteria.mode !== "rewatch" && pick.times === 0 && (
        <form action={seenItBefore.bind(null, pick.tmdbId, pick.title, pick.year, another)} className="text-center">
          <button type="submit" className="rounded-lg px-3 py-2 text-sm text-stone-600 underline hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800">
            Seen it before, show me another
          </button>
        </form>
      )}
      <p className="text-center text-xs text-stone-500">
        {criteria.mode === "rewatch"
          ? `1 of ${total.toLocaleString("en-GB")} past watches on your services`
          : `From ${total.toLocaleString("en-GB")} films on your services, best known first`}
        {criteria.exclude?.length ? <> · <Link href={href({ not: undefined })} className="underline">reset</Link></> : null}
        {checking && " · still checking some past watches"}
      </p>

      {runnersUp.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-stone-600 dark:text-stone-400">Or maybe</h2>
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {runnersUp.map((r) => (
              <li key={r.tmdbId} className="flex min-h-11 items-center gap-3 px-3 py-2">
                {r.posterPath ? (
                  <Image src={`https://image.tmdb.org/t/p/w92${r.posterPath}`} alt="" width={24} height={36} className="h-9 w-6 shrink-0 rounded-sm object-cover" />
                ) : (
                  <span className="h-9 w-6 shrink-0 rounded-sm bg-stone-200 dark:bg-stone-700" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {r.title}
                  {r.year && <span className="text-stone-500"> ({r.year})</span>}
                </span>
                <span className="shrink-0 text-xs text-stone-500">{r.services[0] ?? ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-center text-xs text-stone-500">Streaming data from JustWatch.</p>
    </>
  );
}

function watchedLine(p: ServicePick) {
  if (p.times === 0) return "Never watched";
  return `Watched ${p.times === 1 ? "once" : `${p.times} times`}, last on ${new Date(`${p.lastWatched}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}
