"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { EditWatchState } from "@/app/watches/[id]/actions";
import type { WatchDetail } from "@/db/queries";

const field =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-900";

type Format = { id: number; name: string; kind: string };

/**
 * `save` is the update action already bound to this watch on the server page.
 * Binding it here instead (a new server reference every render) crashed the
 * dev server when re-rendering a validation error.
 */
export function EditWatchForm({ save, watch, formats, today, back }: {
  save: (prev: EditWatchState, form: FormData) => Promise<EditWatchState>;
  watch: WatchDetail; formats: Format[]; today: string; back: string;
}) {
  const [state, action, pending] = useActionState<EditWatchState, FormData>(save, {});
  const kinds = ["disc", "cinema", "streaming", "tv", "download", "other"];

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="back" value={back} />
      <label className="block space-y-1">
        <span className="text-sm font-medium">Film</span>
        <input name="title" defaultValue={watch.title} required className={field} autoComplete="off" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-sm font-medium">Release year</span>
          <input name="year" defaultValue={watch.releaseYear ?? ""} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} className={field} />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Watched on</span>
          <input type="date" name="watched_on" defaultValue={watch.watchedOn} max={today} className={field} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Where</span>
        <select name="format_id" defaultValue={watch.formatId} className={field}>
          {kinds.map((k) => {
            const fs = formats.filter((f) => f.kind === k);
            return fs.length ? (
              <optgroup key={k} label={k[0].toUpperCase() + k.slice(1)}>
                {fs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </optgroup>
            ) : null;
          })}
        </select>
        {watch.fromMemory && (
          <span className="block text-xs text-stone-500">This format was filled in from memory (aNote didn&apos;t record it). Changing it marks it as confirmed.</span>
        )}
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{state.error}</p>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={pending}
          className="flex-1 rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900">
          {pending ? "Saving…" : "Save changes"}
        </button>
        <Link href={back} className="rounded-lg px-4 py-2.5 text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-900">Cancel</Link>
      </div>
    </form>
  );
}
