import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteBox, updateBox } from "@/app/box/actions";
import { BoxForm } from "@/components/box-form";
import { getBox } from "@/db/queries";
import { UUID } from "@/lib/form-values";

export const metadata: Metadata = { title: "Edit box · SpineFind" };

export default async function EditBoxPage({ params }: PageProps<"/box/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const box = await getBox(id);
  if (!box) notFound();
  const back = `/?q=${encodeURIComponent(box.title)}${box.location !== "shelf" ? `&location=${box.location}` : ""}`;
  const loggedWatches = box.items.reduce((n, it) => n + it.watches, 0);

  return (
    <main className="mx-auto w-full min-w-0 max-w-xl flex-1 space-y-6 px-4 py-6">
      <header>
        <Link href={back} className="text-sm text-stone-600 hover:underline dark:text-stone-400">← Shelf</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit box</h1>
      </header>

      <BoxForm
        action={updateBox.bind(null, box.id)}
        initial={{ title: box.title, colours: box.spineColours, location: box.location, items: box.items }}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        cancelHref={back}
      />

      {/* Deleting takes two taps: open this, then confirm. Works without JavaScript. */}
      <details className="rounded-lg border border-red-200 p-3 dark:border-red-900">
        <summary className="cursor-pointer text-sm text-red-700 dark:text-red-400">Delete this box…</summary>
        <form action={deleteBox.bind(null, box.id)} className="mt-3 space-y-2">
          <input type="hidden" name="confirm" value="yes" />
          <p className="text-sm">
            This removes <strong>{box.title}</strong> and its {box.items.length === 1 ? "film" : `${box.items.length} films`} from your catalogue.
            {loggedWatches > 0 && <> Your {loggedWatches === 1 ? "watch" : `${loggedWatches} watches`} of {box.items.length === 1 ? "it" : "them"} stay in your watch log.</>}
            {" "}If you still own it but it&apos;s moved, change <em>Kept</em> to the loft instead.
          </p>
          <button type="submit" className="w-full rounded-lg bg-red-700 px-4 py-2.5 font-medium text-white">Yes, delete the box</button>
        </form>
      </details>
    </main>
  );
}
