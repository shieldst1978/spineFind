"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { BoxFormState } from "@/app/box/actions";
import { Spine } from "@/components/spine";
import { COLOUR_NAMES } from "@/lib/colours";

const FORMATS = ["4K UltraHD", "Blu Ray", "DVD", "HD DVD"] as const;
const field =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-900";

type Row = { key: number; id: string; title: string; year: string; format: string };

export type BoxFormInitial = {
  title: string;
  colours: string[];
  location: string;
  items: { id: string; title: string; year: number | null; format: string }[];
};

/** The box form for both adding and editing. Existing films carry their id so they're updated, not replaced. */
export function BoxForm({
  action: serverAction,
  initial,
  submitLabel,
  pendingLabel,
  cancelHref,
}: {
  action: (prev: BoxFormState, form: FormData) => Promise<BoxFormState>;
  initial?: BoxFormInitial;
  submitLabel: string;
  pendingLabel: string;
  cancelHref: string;
}) {
  const [state, action, pending] = useActionState<BoxFormState, FormData>(serverAction, {});
  const [title, setTitle] = useState(initial?.title ?? "");
  const [colours, setColours] = useState(() => [0, 1, 2].map((i) => initial?.colours[i] ?? ""));
  const [location, setLocation] = useState(initial?.location ?? "shelf");
  const [rows, setRows] = useState<Row[]>(() =>
    initial?.items.length
      ? initial.items.map((it, i) => ({ key: i, id: it.id, title: it.title, year: it.year ? String(it.year) : "", format: it.format }))
      : [{ key: 0, id: "", title: "", year: "", format: "Blu Ray" }],
  );
  const removedExisting = (initial?.items.length ?? 0) - rows.filter((r) => r.id).length;

  const single = rows.length === 1;
  const setRow = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((rs) => [...rs, { key: Math.max(...rs.map((r) => r.key)) + 1, id: "", title: "", year: "", format: rs.at(-1)!.format }]);

  return (
    <form action={action} className="space-y-6">
      <section className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Box title</span>
          <input name="title" required value={title} onChange={(e) => setTitle(e.target.value)} className={field}
            placeholder="As printed on the spine, e.g. The Mexico Trilogy" autoComplete="off" />
        </label>

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Spine colours, main colour first</legend>
          <div className="flex items-stretch gap-3">
            <Spine colours={colours.filter(Boolean)} className="min-h-24" />
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
              {colours.map((c, i) => (
                <select key={i} name={`colour${i + 1}`} value={c} required={i === 0} className={field}
                  onChange={(e) => setColours((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))}>
                  <option value="">{i === 0 ? "Main colour" : `Colour ${i + 1} (optional)`}</option>
                  {COLOUR_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              ))}
            </div>
          </div>
        </fieldset>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Kept</span>
          <select name="location" value={location} onChange={(e) => setLocation(e.target.value)} className={field}>
            <option value="shelf">On the shelf</option>
            <option value="loft">In the loft</option>
            <option value="gone">Gone (sold or given away)</option>
          </select>
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{single ? "Film" : `Films in the box (${rows.length})`}</h2>
        {rows.map((r, i) => (
          <div key={r.key} className="space-y-2 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <input type="hidden" name="item_id" value={r.id} />
            <div className="flex items-center gap-2">
              <input name="item_title" value={r.title} onChange={(e) => setRow(r.key, { title: e.target.value })}
                className={field} autoComplete="off"
                placeholder={single ? (title ? `Same as box: ${title}` : "Film title (blank = box title)") : `Film ${i + 1} title`}
                aria-label={`Film ${i + 1} title`} />
              {!single && (
                <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  className="shrink-0 rounded-lg px-3 py-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                  aria-label={`Remove film ${i + 1}`}>✕</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input name="item_year" value={r.year} onChange={(e) => setRow(r.key, { year: e.target.value })}
                className={field} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="Year"
                aria-label={`Film ${i + 1} release year`} />
              <select name="item_format" value={r.format} onChange={(e) => setRow(r.key, { format: e.target.value })}
                className={field} aria-label={`Film ${i + 1} format`}>
                {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
        ))}
        <button type="button" onClick={addRow}
          className="w-full rounded-lg border border-dashed border-stone-300 py-2 text-sm text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-900">
          + Add another film (box set)
        </button>
        {removedExisting > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {removedExisting === 1 ? "1 film" : `${removedExisting} films`} will be taken out of this box when you save. Their watches stay in your log.
          </p>
        )}
      </section>

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {state.error}
        </p>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={pending}
          className="flex-1 rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900">
          {pending ? pendingLabel : submitLabel}
        </button>
        <Link href={cancelHref} className="rounded-lg px-4 py-2.5 text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-900">
          Cancel
        </Link>
      </div>
    </form>
  );
}
