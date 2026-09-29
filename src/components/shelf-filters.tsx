"use client";

import Link from "next/link";
import { useRef } from "react";
import { COLOUR_NAMES, swatch } from "@/lib/colours";

type Props = {
  q: string;
  colours: string[];
  format: string;
  location: string;
  watched: string;
};

/**
 * A plain GET form, so every search is a shareable URL and works before
 * JavaScript loads. With JavaScript, filters apply as soon as they change.
 */
export function ShelfFilters({ q, colours, format, location, watched }: Props) {
  const form = useRef<HTMLFormElement>(null);
  const submit = () => form.current?.requestSubmit();

  return (
    <form
      ref={form}
      action="/"
      className="space-y-4"
      onChange={(e) => {
        // The title box submits on Enter/Search; everything else applies immediately.
        const target = e.target as EventTarget;
        if (!(target instanceof HTMLInputElement && target.type === "search")) submit();
      }}
    >
      <div className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Film or box set title"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-900"
        />
        <button type="submit" className="rounded-lg bg-stone-900 px-4 py-2 font-medium text-white dark:bg-stone-100 dark:text-stone-900">
          Search
        </button>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-stone-600 dark:text-stone-400">Spine colours you can see</legend>
        <div className="flex flex-wrap gap-2">
          {COLOUR_NAMES.map((c) => (
            <label key={c} className="cursor-pointer">
              <input type="checkbox" name="colour" value={c} defaultChecked={colours.includes(c)} className="peer sr-only" />
              <span className="flex items-center gap-1.5 rounded-full border border-stone-300 px-2.5 py-1 text-sm peer-checked:border-stone-900 peer-checked:bg-stone-900 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 dark:border-stone-700 dark:peer-checked:border-stone-100 dark:peer-checked:bg-stone-100 dark:peer-checked:text-stone-900">
                <span className="size-3.5 rounded-full ring-1 ring-black/20" style={{ backgroundColor: swatch(c) }} />
                {c}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <Select name="format" value={format} label="Format" options={[["", "Any format"], ["4K UltraHD", "4K UltraHD"], ["Blu Ray", "Blu Ray"], ["DVD", "DVD"], ["HD DVD", "HD DVD"]]} />
        <Select name="location" value={location} label="Where" options={[["shelf", "On the shelf"], ["loft", "In the loft"], ["gone", "Gone"], ["all", "Anywhere"]]} />
        <Select name="watched" value={watched} label="Watched" options={[["", "Watched or not"], ["unwatched", "Not watched"], ["watched", "Watched"]]} />
      </div>

      {(q || colours.length > 0 || format || watched || (location && location !== "shelf")) && (
        <Link href="/" className="inline-block text-sm text-stone-600 underline dark:text-stone-400">Clear filters</Link>
      )}
    </form>
  );
}

function Select({ name, value, label, options }: { name: string; value: string; label: string; options: [string, string][] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-stone-600 dark:text-stone-400">{label}</span>
      <select name={name} defaultValue={value} className="w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 py-2 text-base sm:text-sm dark:border-stone-700 dark:bg-stone-900">
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}
