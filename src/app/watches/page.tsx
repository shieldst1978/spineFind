import type { Metadata } from "next";
import Link from "next/link";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { listViewingFormats, searchWatches, watchDecades, watchYears, type WatchFilters } from "@/db/queries";

export const metadata: Metadata = { title: "Watches · SpineFind" };

const KINDS = ["disc", "cinema", "streaming", "tv", "download", "other"];
const SORTS = ["date", "title", "release", "times", "age"] as const;
// 16px text on phones: iOS Safari zooms the page into any control smaller than
// that when tapped. min-w-0 stops a select sizing to its longest option.
const field =
  "w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 py-2 text-base sm:text-sm dark:border-stone-700 dark:bg-stone-900";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const int = (v: string) => (/^\d+$/.test(v) ? Number(v) : undefined);

export default async function WatchesPage({ searchParams }: PageProps<"/watches">) {
  const sp: SP = await searchParams;
  const formatParam = one(sp.format);
  const filters: WatchFilters = {
    q: one(sp.q) || undefined,
    year: int(one(sp.year)),
    formatId: formatParam.startsWith("f") ? int(formatParam.slice(1)) : undefined,
    kind: formatParam.startsWith("k") && KINDS.includes(formatParam.slice(1)) ? formatParam.slice(1) : undefined,
    decade: int(one(sp.decade)),
    owned: one(sp.owned) === "yes" || one(sp.owned) === "no" ? (one(sp.owned) as "yes" | "no") : undefined,
    sort: SORTS.find((s) => s === one(sp.sort)) ?? "date",
    dir: one(sp.dir) === "asc" ? "asc" : "desc",
    page: int(one(sp.page)) ?? 1,
  };

  const [{ rows, summary: s, page, pages }, formats, years, decades] = await Promise.all([
    searchWatches(filters),
    listViewingFormats(),
    watchYears(),
    watchDecades(),
  ]);
  // Remount the filter form whenever the filters change so its dropdowns never show stale choices.
  const filterKey = ["q", "year", "format", "decade", "owned", "sort", "dir"].map((k) => one(sp[k])).join("|");

  // Links that keep the current filters but change one thing.
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) p.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    return `/watches${qs ? `?${qs}` : ""}`;
  };
  const sortLink = (col: (typeof SORTS)[number], label: string, numeric = false) => {
    const active = filters.sort === col;
    const nextDir = active ? (filters.dir === "asc" ? "desc" : "asc") : numeric || col === "date" ? "desc" : "asc";
    return (
      <Link href={href({ sort: col, dir: nextDir, page: undefined })} className="inline-flex items-center gap-1 hover:underline">
        {label}
        {active && <span aria-hidden>{filters.dir === "asc" ? "↑" : "↓"}</span>}
      </Link>
    );
  };
  // Where an edit returns to: this view, minus any one-off confirmation message.
  const backHere = href({ logged: undefined, updated: undefined, deleted: undefined });
  const filtering = Boolean(filters.q || filters.year || filters.formatId || filters.kind || filters.decade !== undefined || filters.owned);

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Watches</h1>
        <Link href="/watches/new" className="shrink-0 rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-900">
          + Log a watch
        </Link>
      </header>

      {(one(sp.logged) || one(sp.updated) || one(sp.deleted)) && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {one(sp.logged) ? <>Logged <strong>{one(sp.logged)}</strong>. It&apos;s at the top of the list.</>
            : one(sp.updated) ? <>Saved your changes to <strong>{one(sp.updated)}</strong>.</>
            : <>Deleted the watch of <strong>{one(sp.deleted)}</strong>.</>}
        </p>
      )}

      <AutoSubmitForm key={filterKey} action="/watches" className="mb-4 space-y-2">
        <div className="flex gap-2">
          <input type="search" name="q" defaultValue={filters.q} placeholder="Film title"
            className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-900" />
          <button type="submit" className="rounded-lg bg-stone-900 px-4 py-2 font-medium text-white dark:bg-stone-100 dark:text-stone-900">Search</button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <select name="year" defaultValue={one(sp.year)} className={field} aria-label="Year watched">
            <option value="">Any year</option>
            {years.map((y) => <option key={y.year} value={y.year}>{y.year} ({y.n})</option>)}
          </select>
          <select name="format" defaultValue={formatParam} className={field} aria-label="Format">
            <option value="">Any format</option>
            <optgroup label="Kind">
              {KINDS.map((k) => <option key={k} value={`k${k}`}>All {k}</option>)}
            </optgroup>
            <optgroup label="Format">
              {formats.filter((f) => f.uses > 0).map((f) => <option key={f.id} value={`f${f.id}`}>{f.name} ({f.uses})</option>)}
            </optgroup>
          </select>
          <select name="decade" defaultValue={one(sp.decade)} className={field} aria-label="Release decade">
            <option value="">Any decade</option>
            {decades.map((d) => <option key={d.decade} value={d.decade}>{d.decade}s ({d.n})</option>)}
          </select>
          <select name="owned" defaultValue={one(sp.owned)} className={field} aria-label="Owned">
            <option value="">Owned or not</option>
            <option value="yes">Owned on disc</option>
            <option value="no">Not owned</option>
          </select>
        </div>
        {filters.sort !== "date" && <input type="hidden" name="sort" value={filters.sort} />}
        {filters.dir === "asc" && <input type="hidden" name="dir" value="asc" />}
        {filtering && <Link href="/watches" className="inline-block text-sm text-stone-600 underline dark:text-stone-400">Clear filters</Link>}
      </AutoSubmitForm>

      <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Watches" value={s.total.toLocaleString("en-GB")} note={`${s.films.toLocaleString("en-GB")} different films`} />
        <Stat label="Top decade" value={s.topDecade != null ? `${s.topDecade}s` : "–"} note={s.topDecadeShare != null ? `${Math.round(s.topDecadeShare * 100)}% of watches` : undefined} />
        <Stat label="Typical age" value={s.medianAge != null ? `${s.medianAge} yrs` : "–"} note="median, release to watch" />
        <Stat label="Rewatches" value={s.rewatches.toLocaleString("en-GB")}
          note={s.total ? `disc ${pct(s.disc, s.total)} · cinema ${pct(s.cinema, s.total)}` : undefined} />
      </dl>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">No watches match.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400">
              <tr>
                <th className="px-3 py-2 font-medium">{sortLink("date", "Watched")}</th>
                <th className="px-3 py-2 font-medium">{sortLink("title", "Film")}</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">{sortLink("release", "Released", true)}</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Format</th>
                <th className="hidden px-3 py-2 text-right font-medium md:table-cell">{sortLink("age", "Age", true)}</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">{sortLink("times", "Watch", true)}</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Owned</th>
                <th className="w-0 px-1 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {rows.map((w) => (
                <tr key={w.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(w.watchedOn)}</td>
                  <td className="px-3 py-2">
                    {w.ownedItemId ? (
                      <Link href={`/item/${w.ownedItemId}`} className="hover:underline">{w.title}</Link>
                    ) : (
                      w.title
                    )}
                    <span className="text-stone-500 sm:hidden">{w.releaseYear ? ` (${w.releaseYear})` : ""}</span>
                    {/* Phone: the hidden columns fold into a second line. */}
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-stone-500 sm:hidden">
                      <FormatLabel format={w.format} kind={w.kind} fromMemory={w.fromMemory} />
                      {w.times > 1 && <span>{ordinal(w.nth)} of {w.times}</span>}
                      {w.ownedItemId && <span>owned</span>}
                    </div>
                  </td>
                  <td className="hidden px-3 py-2 tabular-nums sm:table-cell">
                    {w.releaseYear ?? <span className="text-stone-400">?</span>}
                    {w.releaseYear && <span className="ml-1 text-xs text-stone-500">{Math.floor(w.releaseYear / 10) * 10}s</span>}
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell"><FormatLabel format={w.format} kind={w.kind} fromMemory={w.fromMemory} /></td>
                  <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{w.age != null ? (w.age <= 0 ? "new" : `${w.age}y`) : ""}</td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums sm:table-cell">
                    {w.times > 1 ? `${ordinal(w.nth)} of ${w.times}` : <span className="text-stone-400">1st</span>}
                  </td>
                  <td className="hidden px-3 py-2 md:table-cell">
                    {w.ownedItemId && <Link href={`/item/${w.ownedItemId}`} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">{w.ownedFormat}</Link>}
                  </td>
                  <td className="w-0 px-1 py-1 text-right">
                    <Link href={`/watches/${w.id}?back=${encodeURIComponent(backHere)}`}
                      className="inline-block rounded px-2 py-1.5 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                      aria-label={`Edit watch of ${w.title} on ${fmtDate(w.watchedOn)}`}>
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? <Link href={href({ page: String(page - 1) })} className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">← Newer</Link> : <span />}
          <span className="text-stone-600 dark:text-stone-400">Page {page} of {pages}</span>
          {page < pages ? <Link href={href({ page: String(page + 1) })} className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">Older →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 dark:border-stone-800 dark:bg-stone-900">
      <dt className="text-xs text-stone-600 dark:text-stone-400">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      {note && <dd className="text-xs text-stone-500">{note}</dd>}
    </div>
  );
}

function FormatLabel({ format, kind, fromMemory }: { format: string; kind: string; fromMemory: boolean }) {
  return (
    <span className={fromMemory ? "italic" : undefined} title={fromMemory ? "Format filled in from memory" : undefined}>
      {format}
      {kind === "disc" && <span className="ml-1 text-emerald-700 dark:text-emerald-400">●</span>}
    </span>
  );
}

function pct(n: number, total: number) {
  return `${Math.round((n / total) * 100)}%`;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmtDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
