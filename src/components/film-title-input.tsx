"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { suggestFilms, type FilmSuggestion } from "@/app/watches/actions";

/**
 * A film title box that suggests matches as you type: your own log and shelf
 * first, then TMDB (with posters). Picking one hands the whole suggestion to
 * `onPick`, so the parent can fill in the year and remember the TMDB id.
 */
export function FilmTitleInput({
  name,
  value,
  onChange,
  onPick,
  placeholder,
  ariaLabel,
  className,
  required,
}: {
  name: string;
  value: string;
  onChange: (title: string) => void;
  onPick: (s: FilmSuggestion) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  required?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<FilmSuggestion[]>([]);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const latest = useRef(0);
  const picked = useRef<string | null>(null);

  // Suggest shortly after typing stops; ignore answers to older keystrokes.
  useEffect(() => {
    if (!open || value === picked.current) return;
    const id = ++latest.current;
    const t = setTimeout(async () => {
      try {
        const s = value.trim() ? await suggestFilms(value) : [];
        if (id === latest.current) { setSuggestions(s); setFailed(false); }
      } catch {
        // Usually a page left open across an update; say so rather than showing nothing.
        if (id === latest.current) { setSuggestions([]); setFailed(true); }
      }
    }, 200);
    return () => clearTimeout(t);
  }, [value, open]);

  const pick = (s: FilmSuggestion) => {
    picked.current = s.title;
    setSuggestions([]);
    setOpen(false);
    onPick(s);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        name={name}
        value={value}
        required={required}
        autoComplete="off"
        className={className}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        onChange={(e) => {
          picked.current = null;
          setOpen(true);
          onChange(e.target.value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      {failed && (
        <p role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          Couldn&apos;t look up films. SpineFind may have been updated since this page opened.{" "}
          <button type="button" onClick={() => window.location.reload()} className="underline">Reload</button>
        </p>
      )}
      {open && suggestions.length > 0 && (
        <ul role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900">
          {suggestions.map((s) => (
            <li key={`${s.source}|${s.title}|${s.year}|${s.tmdbId}`} role="option" aria-selected={false}>
              {/* onMouseDown so the pick lands before the input's blur closes the list. */}
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(s); }} onClick={() => pick(s)}
                className="flex min-h-11 w-full items-center gap-3 px-3 py-1.5 text-left text-base hover:bg-stone-100 sm:text-sm dark:hover:bg-stone-800">
                {s.posterPath ? (
                  <Image src={`https://image.tmdb.org/t/p/w92${s.posterPath}`} alt="" width={28} height={42}
                    className="h-[42px] w-7 shrink-0 rounded-sm object-cover" />
                ) : (
                  <span className="h-[42px] w-7 shrink-0 rounded-sm bg-stone-200 dark:bg-stone-700" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {s.title}
                  {s.year && <span className="text-stone-500"> ({s.year})</span>}
                </span>
                {s.owned && <span className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">owned</span>}
                {s.watches > 0 && <span className="text-xs text-stone-500">{s.watches}× watched</span>}
                {s.source === "tmdb" && <span className="text-xs text-stone-400">TMDB</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
