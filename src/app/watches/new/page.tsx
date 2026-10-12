import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { LogWatchForm } from "@/components/log-watch-form";
import { listViewingFormats } from "@/db/queries";

export const metadata: Metadata = { title: "Log a watch · SpineFind" };

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export default async function NewWatchPage({ searchParams }: PageProps<"/watches/new">) {
  // Render per request: the format list lives in the database, which must not
  // be read at build time.
  await connection();
  const formats = await listViewingFormats();
  // From Pick: ?title=&year=&tmdb=&service= pre-fills the film and, if it matches one of your formats, where.
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const tmdb = Number(one(sp.tmdb));
  const service = fold(one(sp.service));
  const initial = one(sp.title) && Number.isInteger(tmdb) && tmdb > 0
    ? {
        title: one(sp.title).slice(0, 200),
        year: /^\d{4}$/.test(one(sp.year)) ? Number(one(sp.year)) : null,
        tmdbId: tmdb,
        formatId: service ? formats.find((f) => f.kind !== "disc" && (fold(f.name) === service || service.startsWith(fold(f.name))))?.id : undefined,
      }
    : undefined;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
      <header className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Log a watch</h1>
        <Link href="/watches" className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-stone-600 underline hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800">
          Your watch log →
        </Link>
      </header>
      <LogWatchForm formats={formats} today={today} initial={initial} />
    </main>
  );
}
