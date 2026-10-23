import Link from "next/link";

const TABS = [
  { key: "film-log", href: "/watches/new", label: "Log a film" },
  { key: "tv-log", href: "/tv", label: "Log TV" },
  { key: "films", href: "/watches", label: "Film log" },
  { key: "tv", href: "/watches/tv", label: "TV log" },
] as const;

/** The Watches section's sub-navigation: logging and the two logs, films and TV kept apart. */
export function WatchTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4" aria-label="Watches">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} aria-current={active === t.key ? "page" : undefined}
          className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${active === t.key ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
