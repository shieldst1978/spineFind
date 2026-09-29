"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { items, viewingFormats, watches } from "@/db/schema";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function back(itemId: string, params?: Record<string, string>): never {
  revalidatePath("/");
  revalidatePath(`/item/${itemId}`);
  redirect(`/item/${itemId}${params ? `?${new URLSearchParams(params)}` : ""}`);
}

/** Logs a viewing of this item's film. A disc format makes it count as watched. */
export async function logWatch(itemId: string, form: FormData) {
  const formatId = Number(form.get("format_id"));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  // A blank date means today: watches are usually logged straight after watching.
  const watchedOn = String(form.get("watched_on") ?? "").trim() || today;

  if (!ISO_DATE.test(watchedOn) || watchedOn > today || watchedOn < "1900-01-01") {
    back(itemId, { error: "date" });
  }
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  const [format] = await db.select().from(viewingFormats).where(eq(viewingFormats.id, formatId));
  if (!item || item.itemType !== "film") back(itemId, { error: "film" });
  if (!format) back(itemId, { error: "format" });

  await db.insert(watches).values({
    title: item.title,
    releaseYear: item.releaseYear,
    watchedOn,
    formatId: format.id,
    formatFromMemory: false,
    matchKey: item.matchKey,
  });
  back(itemId, { logged: watchedOn });
}

/** Sets or clears "seen before logging" (the old watched_status flag). */
export async function setSeenBefore(itemId: string, seen: boolean) {
  await db
    .update(items)
    .set({ watchedBeforeLogging: seen, updatedAt: new Date() })
    .where(and(eq(items.id, itemId), eq(items.itemType, "film")));
  back(itemId);
}
