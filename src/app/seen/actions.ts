"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { text } from "@/lib/form-values";

/**
 * Marks the ticked films as seen before you started logging: every copy of
 * each film gets "seen before, no date", the same as the film page's button.
 */
export async function markSeenBefore(form: FormData) {
  const keys = [...new Set(form.getAll("film").map((v) => text(v)).filter((k) => k && k.length < 300))];
  if (keys.length) {
    await db.execute(sql`update items set watched_before_logging = true, updated_at = now()
      where item_type = 'film' and not watched_before_logging and film_key in ${keys}`);
  }
  revalidatePath("/", "layout");
  const where = text(form.get("where"));
  const p = new URLSearchParams({ saved: String(keys.length) });
  if (where === "shelf" || where === "loft") p.set("where", where);
  // Stay on the page you were on (films you skipped stay on earlier pages).
  const page = text(form.get("page"));
  if (/^\d{1,4}$/.test(page) && page !== "1") p.set("page", page);
  redirect(`/seen?${p}`);
}
