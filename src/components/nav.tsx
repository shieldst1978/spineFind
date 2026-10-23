"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  // First: Log a watch is the front page and the thing you do most; the log is linked from there.
  { href: "/watches/new", label: "Watches", match: (p: string) => p === "/" || p.startsWith("/watches") || p.startsWith("/tv") },
  { href: "/shelf", label: "Shelf", match: (p: string) => p === "/shelf" || p.startsWith("/item") || p.startsWith("/box") || p === "/add" },
  { href: "/pick", label: "Pick", match: (p: string) => p.startsWith("/pick") },
  { href: "/ask", label: "Ask", match: (p: string) => p.startsWith("/ask") },
  { href: "/stats", label: "Stats", match: (p: string) => p.startsWith("/stats") },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="sticky top-0 z-10 border-b border-stone-200 bg-[var(--background)]/90 backdrop-blur dark:border-stone-800">
      {/* Five tabs plus the name fit a phone; on the narrowest screens the row scrolls rather than wrapping. */}
      <div className="mx-auto flex max-w-5xl items-center gap-0 overflow-x-auto px-2 sm:gap-1 sm:px-4">
        <Link href="/" className="mr-1.5 shrink-0 py-3 font-semibold tracking-tight sm:mr-3">SpineFind</Link>
        {LINKS.map((l) => {
          const active = l.match(pathname);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-md px-2 py-1.5 text-sm sm:px-3 ${active ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"}`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
