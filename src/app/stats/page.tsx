import type { Metadata } from "next";
import Link from "next/link";
import { watchStats, type Basis, type Kind, type WatchStats } from "@/db/stats";

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
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const basis: Basis = one(sp.count) === "seen" ? "seen" : "log";
  const seen = basis === "seen";
  // Films seen outside the log have no dates, so "every film I've seen" is always all time.
  const year = !seen && /^\d{4}$/.test(one(sp.year)) ? Number(one(sp.year)) : undefined;
  const s = await watchStats(year, basis);
  const years = [...new Set(s.perYear.map((r) => r.year))].sort((a, b) => b - a);
  const t = s.totals;
  const films = seen ? "films seen" : "films watched";
  const extra = (r: { films: number; watches: number }) => (r.watches > r.films ? `${r.watches} logged watches` : "");

  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl flex-1 space-y-5 px-4 py-6">
      <header className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Stats{year && <span className="font-normal text-stone-500"> · {year}</span>}</h1>
          <Link href="/watches" className="shrink-0 text-sm text-stone-600 underline dark:text-stone-400">Watch log →</Link>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-stone-600 dark:text-stone-400">Count:</span>
          <span className="inline-flex rounded-lg border border-stone-300 p-0.5 dark:border-stone-700" role="group" aria-label="Count">
            <Link href={year ? `/stats?year=${year}` : "/stats"} aria-current={!seen ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 ${!seen ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-600 dark:text-stone-400"}`}>
              Logged watches
            </Link>
            <Link href="/stats?count=seen" aria-current={seen ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 ${seen ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-600 dark:text-stone-400"}`}>
              Every film I&apos;ve seen
            </Link>
          </span>
        </div>
        {seen ? (
          <p className="text-xs text-stone-500">
            Each film counted once, whether it&apos;s in your log, your IMDb history or marked seen: {t.seenFilms.toLocaleString("en-GB")} films,
            {" "}{t.seenNeverLogged.toLocaleString("en-GB")} of them never logged. Those have no dates, so this is all time; watches per year and rewatches
            still come from your log.
          </p>
        ) : (
          /* Scrolls sideways on its own; the page never does. */
          <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1" aria-label="Year">
            <YearChip label="All time" href="/stats" active={!year} />
            {years.map((y) => <YearChip key={y} label={String(y)} href={`/stats?year=${y}`} active={year === y} />)}
          </nav>
        )}
      </header>

      {t.watches === 0 && !seen ? (
        <p className={card}>No watches logged {year ? `in ${year}` : "yet"}.</p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {seen ? (
              <>
                <Figure value={t.seenFilms} label="films seen" />
                <Figure value={t.seenNeverLogged} label="seen but never logged" />
                <Figure value={t.films} label="films in your log" />
                <Figure value={t.watches} label="logged watches" />
              </>
            ) : (
              <>
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
              </>
            )}
          </section>

          <PerYear rows={s.perYear} selected={year} />
          <Decades rows={s.decades} year={year} seen={seen} />

          <div className="grid gap-5 sm:grid-cols-2">
            <Ranked title="Directors" note={films} rows={s.directors.map((d) => ({ label: d.name, n: d.films, extra: extra(d) }))} />
            <Ranked title="Actors" note={`${films}, top 10 billed`} rows={s.actors.map((a) => ({ label: a.name, n: a.films, extra: extra(a) }))} />
            <Ranked title="Actresses" note={`${films}, top 10 billed`} rows={s.actresses.map((a) => ({ label: a.name, n: a.films, extra: extra(a) }))} />
            <Ranked title="Genres" note={films} rows={s.genres.map((g) => ({ label: g.name, n: g.films, extra: extra(g) }))} />
            <Ranked title="Most rewatched" note="times watched, from your log" rows={s.rewatched.map((r) => ({ label: `${r.title}${r.year ? ` (${r.year})` : ""}`, n: r.times, extra: "" }))}
              empty={year ? `Nothing watched twice in ${year}.` : "No rewatches yet."} />
          </div>

          <p className="text-xs text-stone-500">
            Films are counted once however you spelled them, once they&apos;re linked to TMDB. Directors, actors and genres come from TMDB, so unlinked films aren&apos;t in those lists.
            {!seen && t.fromMemory > 0 && ` ${t.fromMemory.toLocaleString("en-GB")} of these watches are from the aNote years, with the format filled in from memory.`}
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
function Decades({ rows, year, seen }: { rows: WatchStats["decades"]; year?: number; seen: boolean }) {
  const verb = seen ? "seen" : "watched";
  const w = rows.reduce((a, r) => a + r.watches, 0);
  const o = rows.reduce((a, r) => a + r.owned, 0);
  const max = Math.max(...rows.map((r) => Math.max(pct(r.watches, w), pct(r.owned, o))), 1);
  const top = [...rows].sort((a, b) => b.watches - a.watches)[0];
  // The decade your shelf has most of, relative to how much of it you watch.
  const gap = [...rows].sort((a, b) => (pct(b.owned, o) - pct(b.watches, w)) - (pct(a.owned, o) - pct(a.watches, w)))[0];
  return (
    <section className={`${card} space-y-3`}>
      <div>
        <h2 className="font-medium">Release decades: what you {seen ? "have seen" : "watch"} vs what you own</h2>
        <p className="text-xs text-stone-500">
          For each decade, <span className="inline-block size-2 rounded-full bg-sky-500" /> <strong className="font-medium">{verb}</strong> is the share of {seen ? "every film you've seen" : year ? `${year}'s watches` : "all your watches"}
          {seen ? " from that decade, " : " that were films from that decade, "}and <span className="inline-block size-2 rounded-full bg-stone-400" /> <strong className="font-medium">owned</strong> is the share of the films you own.
          {top && w > 0 && ` You ${seen ? "have seen" : "watch"} the ${top.decade}s most (${pct(top.watches, w)}%).`}
          {gap && pct(gap.owned, o) - pct(gap.watches, w) >= 3 && ` Your shelf is heaviest on the ${gap.decade}s compared with your ${seen ? "viewing" : "watching"}: ${pct(gap.owned, o)}% of what you own, ${pct(gap.watches, w)}% of what you've ${verb}.`}
        </p>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.decade} className="grid grid-cols-[2.75rem_1fr] items-center gap-2 text-sm">
            <span className="tabular-nums text-stone-600 dark:text-stone-400">{r.decade}s</span>
            <span className="space-y-0.5">
              <Bar width={(100 * pct(r.watches, w)) / max} className="bg-sky-500" label={`${verb} ${pct(r.watches, w)}%`} />
              <Bar width={(100 * pct(r.owned, o)) / max} className="bg-stone-400" label={`owned ${pct(r.owned, o)}%`} />
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
