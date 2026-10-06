"use server";

import { and, eq, max, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { enrichFilms, linkTmdbId } from "@/db/film-link";
import { items, location as locationEnum, mediaFormat, products } from "@/db/schema";
import { COLOUR_NAMES } from "@/lib/colours";
import { parseYear, text, UUID } from "@/lib/form-values";
import { itemTypeFor } from "@/lib/item-type";
import { matchKey } from "@/lib/match-key";

export type BoxFormState = { error?: string };

type Format = (typeof mediaFormat.enumValues)[number];
type Location = (typeof locationEnum.enumValues)[number];
type Row = { id: string | null; title: string; year: number | null; format: Format; tmdbId: number | null };

/** Reads and checks the box form shared by Add and Edit. */
function parseBoxForm(form: FormData): { title: string; colours: string[]; location: Location; rows: Row[] } | { error: string } {
  const colours = ["colour1", "colour2", "colour3"].map((k) => text(form.get(k))).filter((c) => COLOUR_NAMES.includes(c));
  const location = text(form.get("location")) as Location;

  const ids = form.getAll("item_id").map(text);
  const titles = form.getAll("item_title").map(text);
  const years = form.getAll("item_year").map(text);
  const formats = form.getAll("item_format").map(text);
  const tmdbIds = form.getAll("item_tmdb_id").map(text);

  const rows: Row[] = [];
  for (let i = 0; i < titles.length; i++) {
    const filmTitle = titles[i];
    if (!filmTitle && !years[i]) continue;
    if (!filmTitle) return { error: `Film ${i + 1} needs a title.` };
    const year = parseYear(years[i] ?? "");
    if ("error" in year) return { error: `"${filmTitle}": ${year.error}` };
    const format = formats[i] as Format;
    if (!mediaFormat.enumValues.includes(format)) return { error: `"${filmTitle}": choose a format.` };
    const tmdbId = /^\d{1,9}$/.test(tmdbIds[i] ?? "") ? Number(tmdbIds[i]) : null;
    rows.push({ id: UUID.test(ids[i] ?? "") ? ids[i] : null, title: filmTitle, year: year.year, format, tmdbId });
  }
  if (!rows.length) return { error: "Add at least one film." };

  // The box is named after its first film unless you gave it its own title.
  const title = text(form.get("title")) || rows[0].title;
  if (!colours.length) return { error: "Pick at least the main spine colour." };
  if (!locationEnum.enumValues.includes(location)) return { error: "Choose where the box is kept." };
  return { title, colours, location, rows };
}

/** Each film's TMDB link: picked from suggestions, or inherited from the same title + year already in the app. */
const linkRows = (rows: Row[]) => Promise.all(rows.map((r) => linkTmdbId(r.title, r.year, r.tmdbId)));

function shelfLink(title: string, location: Location, flag: string) {
  const p = new URLSearchParams({ q: title, [flag]: "1" });
  if (location !== "shelf") p.set("location", location);
  return `/?${p}`;
}

export async function addBox(_prev: BoxFormState, form: FormData): Promise<BoxFormState> {
  const box = parseBoxForm(form);
  if ("error" in box) return box;
  const linked = await linkRows(box.rows);

  await db.transaction(async (tx) => {
    const [{ next }] = await tx.select({ next: max(items.legacyNumber) }).from(items);
    const [p] = await tx.insert(products).values({ title: box.title, spineColours: box.colours, location: box.location }).returning({ id: products.id });
    await tx.insert(items).values(
      box.rows.map((r, i) => ({
        productId: p.id,
        // Continues the spreadsheet's numbering so rows can be written back later.
        legacyNumber: (next ?? 0) + i + 1,
        position: i + 1,
        title: r.title,
        releaseYear: r.year,
        itemType: itemTypeFor(r.title),
        format: r.format,
        matchKey: matchKey(r.title, r.year),
        tmdbId: linked[i],
      })),
    );
  });
  await enrichFilms(linked);

  revalidatePath("/", "layout");
  redirect(shelfLink(box.title, box.location, "added"));
}

/** Saves a box: its title, spine, location and films (changed, added or removed). */
export async function updateBox(productId: string, _prev: BoxFormState, form: FormData): Promise<BoxFormState> {
  if (!UUID.test(productId)) return { error: "That box doesn't exist." };
  const box = parseBoxForm(form);
  if ("error" in box) return box;
  const linked = await linkRows(box.rows);

  const found = await db.transaction(async (tx) => {
    const [p] = await tx
      .update(products)
      .set({ title: box.title, spineColours: box.colours, location: box.location, updatedAt: new Date() })
      .where(eq(products.id, productId))
      .returning({ id: products.id });
    if (!p) return false;

    const existing = await tx.select().from(items).where(eq(items.productId, productId));
    const byId = new Map(existing.map((it) => [it.id, it]));
    const kept = box.rows.map((r) => r.id).filter((id): id is string => !!id && byId.has(id));

    // Films taken out of the form are removed from the box (their watches stay in the log).
    await tx.delete(items).where(kept.length
      ? and(eq(items.productId, productId), notInArray(items.id, kept))
      : eq(items.productId, productId));

    const [{ next }] = await tx.select({ next: max(items.legacyNumber) }).from(items);
    let nextNumber = (next ?? 0) + 1;
    for (const [i, r] of box.rows.entries()) {
      const values = {
        position: i + 1,
        title: r.title,
        releaseYear: r.year,
        itemType: itemTypeFor(r.title),
        format: r.format,
        matchKey: matchKey(r.title, r.year),
        updatedAt: new Date(),
      };
      const old = r.id ? byId.get(r.id) : undefined;
      if (old) {
        // A film picked from suggestions brings its TMDB id; otherwise a retitled
        // or re-dated film no longer matches its old TMDB entry.
        const sameFilm = old.title === r.title && old.releaseYear === r.year;
        await tx.update(items).set({ ...values, tmdbId: r.tmdbId ?? (sameFilm ? old.tmdbId : null) ?? linked[i] }).where(eq(items.id, old.id));
      } else {
        await tx.insert(items).values({ ...values, productId, legacyNumber: nextNumber++, tmdbId: linked[i] });
      }
    }
    return true;
  });
  if (!found) return { error: "That box doesn't exist any more." };
  await enrichFilms(linked);

  revalidatePath("/", "layout");
  redirect(shelfLink(box.title, box.location, "updated"));
}

/** Deletes a box and the films in it. Watches stay in the log. Needs confirm=yes. */
export async function deleteBox(productId: string, form: FormData) {
  if (!UUID.test(productId) || text(form.get("confirm")) !== "yes") redirect(`/box/${productId}`);
  const [gone] = await db.delete(products).where(eq(products.id, productId)).returning({ title: products.title });
  revalidatePath("/", "layout");
  redirect(gone ? `/?${new URLSearchParams({ deleted: gone.title })}` : "/");
}
