import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditWatchForm } from "@/components/edit-watch-form";
import { getWatch, listViewingFormats } from "@/db/queries";
import { todayUk, UUID } from "@/lib/form-values";
import { deleteWatch, updateWatch } from "./actions";

export const metadata: Metadata = { title: "Edit watch · SpineFind" };

export default async function EditWatchPage({ params, searchParams }: PageProps<"/watches/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [watch, formats] = await Promise.all([getWatch(id), listViewingFormats()]);
  if (!watch) notFound();

  const sp = await searchParams;
  const backParam = typeof sp.back === "string" ? sp.back : "";
  const back = /^\/(watches|item)(\/|\?|$)/.test(backParam) ? backParam : "/watches";

  return (
    <main className="mx-auto w-full min-w-0 max-w-xl flex-1 space-y-6 px-4 py-6">
      <header>
        <Link href={back} className="text-sm text-stone-600 hover:underline dark:text-stone-400">← Back</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit watch</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {watch.fromSpreadsheet ? "Imported from your spreadsheet." : "Logged in SpineFind."}
          {watch.ownedItemId && <> · <Link href={`/item/${watch.ownedItemId}`} className="underline">You own this film</Link></>}
        </p>
      </header>

      <EditWatchForm save={updateWatch.bind(null, watch.id)} watch={watch} formats={formats} today={todayUk()} back={back} />

      {/* Deleting takes two taps: open this, then confirm. Works without JavaScript. */}
      <details className="rounded-lg border border-red-200 p-3 dark:border-red-900">
        <summary className="cursor-pointer text-sm text-red-700 dark:text-red-400">Delete this watch…</summary>
        <form action={deleteWatch.bind(null, watch.id)} className="mt-3 space-y-2">
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="confirm" value="yes" />
          <p className="text-sm">This removes the watch of <strong>{watch.title}</strong> on {fmtDate(watch.watchedOn)} for good.</p>
          <button type="submit" className="w-full rounded-lg bg-red-700 px-4 py-2.5 font-medium text-white">Yes, delete it</button>
        </form>
      </details>
    </main>
  );
}

function fmtDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
