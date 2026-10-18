import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { listServices } from "@/db/streaming";
import { saveServices } from "./actions";
import { uploadWatchlist } from "./watchlist-actions";

export const metadata: Metadata = { title: "Settings · SpineFind" };

/** The biggest UK services by TMDB's ordering; the rest are behind "Show all". */
const TOP = 30;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const sp = await searchParams;
  const all = sp.all === "1";
  const services = await listServices();
  const ticked = services.filter((s) => s.subscribed).length;
  // Ticked services are listed first and always shown, so saving from the short list never unticks one.
  const shown = all ? services : services.slice(0, ticked + TOP);
  const [{ n: onWatchlist }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from watchlist`)).rows;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const synced = one(sp.wl_added) !== "";
  const wl = (k: string) => Number(one(sp[k])) || 0;

  return (
    <main className="mx-auto w-full min-w-0 max-w-xl flex-1 space-y-5 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <section id="watchlist" className="space-y-3">
        <div>
          <h2 className="font-medium">Your watchlist</h2>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Kept on IMDb. Export your IMDb watchlist as a CSV and upload it here whenever it changes: new films are added,
            films you&apos;ve removed on IMDb come off, and TV and films you&apos;ve already seen are left out. Logging a watch takes a
            film off the list. {onWatchlist > 0 && <Link href="/watchlist" className="underline">{onWatchlist} films on your watchlist</Link>}
          </p>
        </div>
        {synced && (
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            Watchlist updated: {wl("wl_added")} added, {wl("wl_kept")} already there, {wl("wl_removed")} removed.
            {wl("wl_seen") > 0 && ` ${wl("wl_seen")} left out as already seen.`}
            {wl("wl_tv") > 0 && ` ${wl("wl_tv")} TV titles skipped.`}
            {wl("wl_missing") > 0 && ` ${wl("wl_missing")} not found on TMDB.`} Posters and details fill in over the next minute or two.
          </p>
        )}
        {one(sp.watchlist_error) && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{one(sp.watchlist_error)}</p>
        )}
        <form action={uploadWatchlist} className="flex flex-wrap items-center gap-2">
          <input type="file" name="csv" accept=".csv,text/csv" required aria-label="IMDb watchlist CSV"
            className="min-w-0 flex-1 text-base sm:text-sm file:mr-3 file:rounded-lg file:border file:border-stone-300 file:bg-white file:px-3 file:py-2 file:text-sm dark:file:border-stone-700 dark:file:bg-stone-900" />
          <button type="submit" className="shrink-0 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-900">Upload</button>
        </form>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-medium">Your streaming services</h2>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Tick the UK services you subscribe to. Film pages then show which of yours a film is on.
            {ticked > 0 && ` ${ticked} ticked.`}
          </p>
        </div>

        {sp.saved && (
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">Saved.</p>
        )}

        {services.length === 0 ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">Couldn&apos;t load the list of services from TMDB. Try again in a moment.</p>
        ) : (
          <form action={saveServices} className="space-y-3">
            {all && <input type="hidden" name="all" value="1" />}
            <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
              {shown.map((s) => (
                <li key={s.providerId}>
                  <label className="flex min-h-12 items-center gap-3 px-3 py-2">
                    <input type="checkbox" name="provider" value={s.providerId} defaultChecked={s.subscribed} className="size-5 shrink-0" />
                    {s.logoPath ? (
                      <Image src={`https://image.tmdb.org/t/p/w92${s.logoPath}`} alt="" width={28} height={28} className="size-7 shrink-0 rounded-md" />
                    ) : (
                      <span className="size-7 shrink-0 rounded-md bg-stone-200 dark:bg-stone-700" />
                    )}
                    <span className="min-w-0 flex-1 break-words text-sm">{s.name}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3">
              <button type="submit" className="flex-1 rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white dark:bg-stone-100 dark:text-stone-900">
                Save
              </button>
              {!all && services.length > shown.length && (
                <Link href="/settings?all=1" className="rounded-lg px-3 py-2.5 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800">
                  Show all {services.length}
                </Link>
              )}
            </div>
          </form>
        )}
        <p className="text-xs text-stone-500">
          Streaming data from <a href="https://www.justwatch.com" className="underline" target="_blank" rel="noreferrer">JustWatch</a>, via TMDB.
        </p>
      </section>
    </main>
  );
}
