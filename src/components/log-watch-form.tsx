"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { addWatch, type FilmSuggestion, type LogWatchState } from "@/app/watches/actions";
import { FilmTitleInput } from "@/components/film-title-input";

const field =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-900";
const KINDS = [
  ["streaming", "Streaming (e.g. a new service)"],
  ["tv", "TV channel"],
  ["cinema", "Cinema"],
  ["disc", "Disc (counts as watching your copy)"],
  ["download", "Download"],
  ["other", "Other"],
] as const;

type Format = { id: number; name: string; kind: string; uses: number };

export function LogWatchForm({ formats, today }: { formats: Format[]; today: string }) {
  const [state, action, pending] = useActionState<LogWatchState, FormData>(addWatch, {});
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [formatId, setFormatId] = useState(String(formats.find((f) => f.kind !== "disc")?.id ?? formats[0]?.id ?? ""));
  const [picked, setPicked] = useState<FilmSuggestion | null>(null);

  const pick = (s: FilmSuggestion) => {
    setTitle(s.title);
    setYear(s.year ? String(s.year) : "");
    setPicked(s);
  };

  const byKind = (kind: string) => formats.filter((f) => f.kind === kind);
  const groups: [string, Format[]][] = [
    ["Streaming", byKind("streaming")],
    ["TV", byKind("tv")],
    ["Cinema", byKind("cinema")],
    ["Disc", byKind("disc")],
    ["Other", [...byKind("download"), ...byKind("other")]],
  ];

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-1">
        <span className="text-sm font-medium">Film</span>
        <div className="flex">
          <FilmTitleInput name="title" required value={title} className={field} placeholder="Start typing a title" ariaLabel="Film title"
            onChange={(t) => { setTitle(t); setPicked(null); }} onPick={pick} />
        </div>
        <input type="hidden" name="tmdb_id" value={picked?.tmdbId ?? ""} />
        {picked?.owned && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">On your shelf: a disc format marks your copy as watched.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-sm font-medium">Release year</span>
          <input name="year" value={year} onChange={(e) => { setYear(e.target.value); setPicked(null); }}
            inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="e.g. 1986" className={field} />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Watched on</span>
          <input type="date" name="watched_on" defaultValue={today} max={today} className={field} aria-describedby="date-hint" />
          <span id="date-hint" className="text-xs text-stone-500">Leave blank for today</span>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Where</span>
        <select name="format_id" value={formatId} onChange={(e) => setFormatId(e.target.value)} className={field}>
          {groups.filter(([, fs]) => fs.length).map(([label, fs]) => (
            <optgroup key={label} label={label}>
              {fs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </optgroup>
          ))}
          <option value="new">New format…</option>
        </select>
      </label>

      {formatId === "new" && (
        <div className="grid gap-2 rounded-lg border border-stone-200 p-3 sm:grid-cols-2 dark:border-stone-800">
          <label className="space-y-1">
            <span className="text-sm">Name</span>
            <input name="new_format_name" required placeholder="e.g. Now TV" className={field} autoComplete="off" />
          </label>
          <label className="space-y-1">
            <span className="text-sm">Kind</span>
            <select name="new_format_kind" defaultValue="streaming" className={field}>
              {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
      )}

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{state.error}</p>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={pending}
          className="flex-1 rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900">
          {pending ? "Logging…" : "Log watch"}
        </button>
        <Link href="/watches" className="rounded-lg px-4 py-2.5 text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-900">Cancel</Link>
      </div>
    </form>
  );
}
