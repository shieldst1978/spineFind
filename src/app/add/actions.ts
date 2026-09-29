"use server";

import { max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { items, location as locationEnum, mediaFormat, products } from "@/db/schema";
import { COLOUR_NAMES } from "@/lib/colours";
import { itemTypeFor } from "@/lib/item-type";
import { matchKey } from "@/lib/match-key";

export type AddBoxState = { error?: string };

type Format = (typeof mediaFormat.enumValues)[number];
type Location = (typeof locationEnum.enumValues)[number];

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export async function addBox(_prev: AddBoxState, form: FormData): Promise<AddBoxState> {
  const boxTitle = text(form.get("title"));
  const colours = ["colour1", "colour2", "colour3"]
    .map((k) => text(form.get(k)))
    .filter((c) => COLOUR_NAMES.includes(c));
  const location = text(form.get("location")) as Location;

  if (!boxTitle) return { error: "Give the box a title." };
  if (!colours.length) return { error: "Pick at least the main spine colour." };
  if (!locationEnum.enumValues.includes(location)) return { error: "Choose where the box is kept." };

  const titles = form.getAll("item_title").map(text);
  const years = form.getAll("item_year").map(text);
  const formats = form.getAll("item_format").map(text);
  const thisYear = new Date().getFullYear();

  const rows: { title: string; year: number | null; format: Format }[] = [];
  for (let i = 0; i < titles.length; i++) {
    // A single-film box can leave the film title blank: it's the box title.
    const title = titles[i] || (titles.length === 1 ? boxTitle : "");
    if (!title && !years[i]) continue;
    if (!title) return { error: `Film ${i + 1} needs a title.` };
    let year: number | null = null;
    if (years[i]) {
      year = Number(years[i]);
      if (!Number.isInteger(year) || year < 1880 || year > thisYear + 2) {
        return { error: `"${title}": the year should be a four-digit year, like 1982.` };
      }
    }
    const format = formats[i] as Format;
    if (!mediaFormat.enumValues.includes(format)) return { error: `"${title}": choose a format.` };
    rows.push({ title, year, format });
  }
  if (!rows.length) return { error: "Add at least one film." };

  await db.transaction(async (tx) => {
    const [{ next }] = await tx.select({ next: max(items.legacyNumber) }).from(items);
    const [box] = await tx
      .insert(products)
      .values({ title: boxTitle, spineColours: colours, location })
      .returning({ id: products.id });
    await tx.insert(items).values(
      rows.map((r, i) => ({
        productId: box.id,
        // Continues the spreadsheet's numbering so rows can be written back later.
        legacyNumber: (next ?? 0) + i + 1,
        position: i + 1,
        title: r.title,
        releaseYear: r.year,
        itemType: itemTypeFor(r.title),
        format: r.format,
        matchKey: matchKey(r.title, r.year),
      })),
    );
  });

  revalidatePath("/");
  const back = new URLSearchParams({ q: boxTitle, added: "1" });
  if (location !== "shelf") back.set("location", location);
  redirect(`/?${back}`);
}
