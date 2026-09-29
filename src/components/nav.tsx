"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Shelf", match: (p: string) => p === "/" || p.startsWith("/item") || p === "/add" },
  { href: "/watches", label: "Watches", match: (p: string) => p.startsWith("/watches") },
  { href: "/pick", label: "Pick", match: (p: string) => p.startsWith("/pick") },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="sticky top-0 z-10 border-b border-stone-200 bg-[var(--background)]/90 backdrop-blur dark:border-stone-800">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-4">
        <Link href="/" className="mr-3 py-3 font-semibold tracking-tight">SpineFind</Link>
        {LINKS.map((l) => {
          const active = l.match(pathname);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"}`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
