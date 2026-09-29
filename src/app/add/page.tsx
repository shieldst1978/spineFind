import type { Metadata } from "next";
import Link from "next/link";
import { addBox } from "@/app/box/actions";
import { BoxForm } from "@/components/box-form";

export const metadata: Metadata = { title: "Add a title · SpineFind" };

export default function AddPage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
      <header className="mb-6">
        <Link href="/" className="text-sm text-stone-600 hover:underline dark:text-stone-400">← Shelf</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Add a title</h1>
      </header>
      <BoxForm action={addBox} submitLabel="Add to SpineFind" pendingLabel="Adding…" cancelHref="/" />
    </main>
  );
}
