import type { Metadata } from "next";
import Link from "next/link";
import { watchStats, type Kind, type WatchStats } from "@/db/stats";

export const metadata: Metadata = { title: "Stats · SpineFind" };

const KINDS: { kind: Kind; label: string; bar: string; dot: string }[] = [
  { kind: "disc", label: "Disc", bar: "bg-emerald-500", dot: "bg-emerald-500" },
  { kind: "streaming", label: "Streaming", bar: "bg-sky-500", dot: "bg-sky-500" },
  { kind: "cinema", label: "Cinema", bar: "bg-amber-500", dot: "bg-amber-500" },
  { kind: "tv", label: "TV", bar: "bg-violet-500", dot: "bg-violet-500" },
  { kind: "download", label: "Other", bar: "bg-stone-400", dot: "bg-stone-400" },
];
const kindOf = (k: Kind) => KINDS.find((x) => x.kind === k) ?? KINDS[4];
const card = "rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900";
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

export default async function StatsPage({ searchParams }: PageProps<"/stats">) {
  const sp = await searchParams;
  const yearParam = Array.isArray(sp.year) ? sp.year[0] : sp.year;
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined;
  const s = await watchStats(year);
  const years = [...new Set(s.perYear.map((r) => r.year))].sort((a, b) => b - a);
  const t = s.totals;

  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl flex-1 space-y-5 px-4 py-6">
      <header className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Stats{year && <span className="font-normal text-stone-500"> · {year}</span>}</h1>
          <Link href="/watches" className="shrink-0 text-sm text-stone-600 underline dark:text-stone-400">Watch log →</Link>
        </div>
        {/* Scrolls sideways on its own; the page never does. */}
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1" aria-label="Year">
          <YearChip label="All time" href="/stats" active={!year} />
          {years.map((y) => <YearChip key={y} label={String(y)} href={`/stats?year=${y}`} active={year === y} />)}
        </nav>
      </header>

      {t.watches === 0 ? (
        <p className={card}>No watches logged {year ? `in ${year}` : "yet"}.</p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure value={t.watches} label="watches" />
            <Figure value={t.films} label="different films" />
            <Figure value={`${pct(t.rewatches, t.watches)}%`} label={`rewatches (${t.rewatches.toLocaleString("en-GB")})`} />
            <Figure value={`${pct(t.disc, t.watches)}%`} label="on disc" />
            <Figure value={t.medianAge ?? "–"} label="median years old when watched" />
            <Figure value={t.avgReleaseYear ? String(t.avgReleaseYear) : "–"} label="average release year" />
            {!year && (
              <Link href="/seen?where=shelf" className="contents">
                <Figure value={`${pct(s.shelf.watched, s.shelf.films)}%`} label={`of the shelf watched (${(s.shelf.films - s.shelf.watched).toLocaleString("en-GB")} to go; seen some before 2009?)`} />
              </Link>
            )}
            {!year && t.first && <Figure value={t.first.slice(0, 4)} label="first logged watch" />}
          </section>

          <PerYear rows={s.perYear} selected={year} />
          <Decades rows={s.decades} year={year} />

          <div className="grid gap-5 sm:grid-cols-2">
            <Ranked title="Directors" note="films watched" rows={s.directors.map((d) => ({ label: d.name, n: d.films, extra: d.watches > d.films ? `${d.watches} watches` : "" }))} />
            <Ranked title="Actors" note="films watched, top 10 billed" rows={s.actors.map((a) => ({ label: a.name, n: a.films, extra: a.watches > a.films ? `${a.watches} watches` : "" }))} />
            <Ranked title="Genres" note="watches" rows={s.genres.map((g) => ({ label: g.name, n: g.watches, extra: "" }))} />
            <Ranked title="Most rewatched" note="times watched" rows={s.rewatched.map((r) => ({ label: `${r.title}${r.year ? ` (${r.year})` : ""}`, n: r.times, extra: "" }))}
              empty={year ? `Nothing watched twice in ${year}.` : "No rewatches yet."} />
          </div>

          <p className="text-xs text-stone-500">
            Films are counted once however you spelled them, once they&apos;re linked to TMDB. Directors, actors and genres come from TMDB, so unlinked films aren&apos;t in those lists.
            {t.fromMemory > 0 && ` ${t.fromMemory.toLocaleString("en-GB")} of these watches are from the aNote years, with the format filled in from memory.`}
          </p>
        </>
      )}
    </main>
  );
}

function YearChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${active ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"}`}>
      {label}
    </Link>
  );
}

function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <div className={card}>
      <p className="text-2xl font-semibold tabular-nums">{typeof value === "number" ? value.toLocaleString("en-GB") : value}</p>
      <p className="text-xs text-stone-500">{label}</p>
    </div>
  );
}

/** Watches per year as horizontal stacked bars, coloured by kind of format. */
function PerYear({ rows, selected }: { rows: WatchStats["perYear"]; selected?: number }) {
  const byYear = new Map<number, Map<Kind, number>>();
  for (const r of rows) {
    const k = r.kind === "other" ? "download" : r.kind;
    const m = byYear.get(r.year) ?? new Map<Kind, number>();
    m.set(k, (m.get(k) ?? 0) + r.n);
    byYear.set(r.year, m);
  }
  const totals = [...byYear].map(([y, m]) => ({ y, m, n: [...m.values()].reduce((a, b) => a + b, 0) }));
  const max = Math.max(...totals.map((x) => x.n), 1);
  return (
    <section className={`${card} space-y-3`}>
      <div>
        <h2 className="font-medium">Watches per year</h2>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
          {KINDS.map((k) => <li key={k.kind} className="flex items-center gap-1"><span className={`size-2 rounded-full ${k.dot}`} />{k.label}</li>)}
        </ul>
      </div>
      <ul className="space-y-1.5">
        {totals.map(({ y, m, n }) => (
          <li key={y}>
            <Link href={selected === y ? "/stats" : `/stats?year=${y}`} className={`grid grid-cols-[2.75rem_1fr_2.5rem] items-center gap-2 rounded text-sm ${selected && selected !== y ? "opacity-40" : ""}`}>
              <span className="tabular-nums text-stone-600 dark:text-stone-400">{y}</span>
              <span className="flex h-4 overflow-hidden rounded-sm" style={{ width: `${(100 * n) / max}%` }}
                title={KINDS.map((k) => `${k.label} ${m.get(k.kind) ?? 0}`).join(", ")}>
                {KINDS.map((k) => (m.get(k.kind) ? <span key={k.kind} className={kindOf(k.kind).bar} style={{ width: `${(100 * m.get(k.kind)!) / n}%` }} /> : null))}
              </span>
              <span className="text-right tabular-nums">{n}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Release decades: what you watch next to what's on your shelf (and in the loft). */
function Decades({ rows, year }: { rows: WatchStats["decades"]; year?: number }) {
  const w = rows.reduce((a, r) => a + r.watches, 0);
  const o = rows.reduce((a, r) => a + r.owned, 0);
  const max = Math.max(...rows.map((r) => Math.max(pct(r.watches, w), pct(r.owned, o))), 1);
  const top = [...rows].sort((a, b) => b.watches - a.watches)[0];
  return (
    <section className={`${card} space-y-3`}>
      <div>
        <h2 className="font-medium">Release decades</h2>
        <p className="text-xs text-stone-500">
          Share of {year ? `${year}'s` : "your"} watches <span className="inline-block size-2 rounded-full bg-sky-500" /> and of the films you own <span className="inline-block size-2 rounded-full bg-stone-400" />.
          {top && w > 0 && ` Most watched: the ${top.decade}s, ${pct(top.watches, w)}%.`}
        </p>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.decade} className="grid grid-cols-[2.75rem_1fr] items-center gap-2 text-sm">
            <span className="tabular-nums text-stone-600 dark:text-stone-400">{r.decade}s</span>
            <span className="space-y-0.5">
              <Bar width={(100 * pct(r.watches, w)) / max} className="bg-sky-500" label={`${pct(r.watches, w)}%`} />
              <Bar width={(100 * pct(r.owned, o)) / max} className="bg-stone-400" label={`${pct(r.owned, o)}%`} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Bar({ width, className, label }: { width: number; className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 rounded-sm ${className}`} style={{ width: `${Math.max(width, 0.5)}%` }} />
      <span className="text-xs tabular-nums text-stone-500">{label}</span>
    </span>
  );
}

function Ranked({ title, note, rows, empty }: { title: string; note: string; rows: { label: string; n: number; extra: string }[]; empty?: string }) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <section className={`${card} space-y-2`}>
      <h2 className="font-medium">{title} <span className="text-xs font-normal text-stone-500">· {note}</span></h2>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">{empty ?? "Nothing yet."}</p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 break-words">{r.label}</span>
                <span className="shrink-0 tabular-nums">{r.n}{r.extra && <span className="text-xs text-stone-500"> · {r.extra}</span>}</span>
              </div>
              <span className="mt-0.5 block h-1 rounded-sm bg-stone-300 dark:bg-stone-600" style={{ width: `${(100 * r.n) / max}%` }} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
