import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { LogWatchForm } from "@/components/log-watch-form";
import { listViewingFormats } from "@/db/queries";

export const metadata: Metadata = { title: "Log a watch · SpineFind" };

export default async function NewWatchPage() {
  // Render per request: the format list lives in the database, which must not
  // be read at build time.
  await connection();
  const formats = await listViewingFormats();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
      <header className="mb-6">
        <Link href="/watches" className="text-sm text-stone-600 hover:underline dark:text-stone-400">← Watches</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Log a watch</h1>
      </header>
      <LogWatchForm formats={formats} today={today} />
    </main>
  );
}
