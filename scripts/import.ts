/**
 * Rebuilds the local database from the two spreadsheets and writes a report.
 *
 *   npm run import
 *
 * Re-runnable: every run wipes and reloads products, items, watches and flags.
 * Spreadsheet paths can be overridden with SPINEFIND_XLSX / WATCHES_XLSX.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createDb } from "../src/db/client";
import { items, products, reviewFlags, viewingFormats, watches } from "../src/db/schema";
import { DISC_TO_MEDIA, SEED_FORMATS } from "../src/db/seed-formats";
import { matchKey, normaliseTitle } from "../src/lib/match-key";

const ROOT = path.resolve(__dirname, "..");
const SPINEFIND_XLSX = process.env.SPINEFIND_XLSX ?? path.join(ROOT, "spinefind_data.xlsx");
const WATCHES_XLSX = process.env.WATCHES_XLSX ?? path.join(ROOT, "Film Data Validated 28-09-2026.xlsx");
const REPORT = path.join(ROOT, "reports", "import-report.md");

/** Watches before this date were logged in aNote, which had no format field. */
const FORMAT_FROM_MEMORY_BEFORE = "2026-01-23";

type Cell = ExcelJS.CellValue;

function text(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString();
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return text(v.result as Cell);
    return "";
  }
  return String(v);
}

/** Collapses odd whitespace (e.g. non-breaking spaces) and trims. */
function clean(v: Cell): string {
  return text(v).replace(/\s+/g, " ").trim();
}

function toYear(v: Cell): number | null {
  const n = parseInt(clean(v), 10);
  return Number.isFinite(n) && n > 1800 && n < 2100 ? n : null;
}

/** Excel serial number or Date -> YYYY-MM-DD (dates have no time of day). */
function toIsoDate(v: Cell): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const n = Number(clean(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

async function readSheet(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as Cell[]).map((v) => clean(v));
  const rows: { row: number; get: (name: string) => Cell }[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const vals = r.values as Cell[];
    if (!vals.some((v) => clean(v) !== "")) return;
    rows.push({
      row: n,
      get: (name) => {
        const i = header.indexOf(name);
        if (i < 0) throw new Error(`${path.basename(file)}: no column "${name}"`);
        return vals[i];
      },
    });
  });
  return rows;
}

const MEDIA_FORMATS: Record<string, "4K UltraHD" | "Blu Ray" | "DVD" | "HD DVD"> = {
  "4kultrahd": "4K UltraHD",
  "4kbluray": "4K UltraHD",
  bluray: "Blu Ray",
  dvd: "DVD",
  hddvd: "HD DVD",
};

function itemTypeFor(title: string): "film" | "tv_season" | "episode" {
  // "Season 9 Episode 18" is a TV episode; "Star Wars: Episode IV" is a film.
  if (/\bseason\b.*\bepisode\b/i.test(title)) return "episode";
  if (/\b(season|series)\b/i.test(title)) return "tv_season";
  return "film";
}

/** watched_status is stored as TRUE/FALSE in Excel; accept 1/0 too. */
function toFlag(v: Cell): boolean {
  return v === true || ["1", "true", "yes"].includes(clean(v).toLowerCase());
}

async function main() {
  const report: string[] = [];
  const say = (line = "") => report.push(line);

  const { client, db } = createDb();
  await migrate(db, { migrationsFolder: path.join(ROOT, "drizzle") });

  await db.execute(sql`truncate review_flags, watches, items, products, viewing_formats restart identity cascade`);

  // ---- viewing formats
  const formatRows = await db
    .insert(viewingFormats)
    .values(SEED_FORMATS.map((f) => ({ name: f.name, kind: f.kind, aliases: f.aliases ?? [] })))
    .returning();
  const fold = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const formatByKey = new Map<string, (typeof formatRows)[number]>();
  for (const f of formatRows) {
    formatByKey.set(fold(f.name), f);
    for (const a of f.aliases) formatByKey.set(fold(a), f);
  }

  // ---- catalogue
  const sfRows = await readSheet(SPINEFIND_XLSX);
  sfRows.sort((a, b) => Number(clean(a.get("number"))) - Number(clean(b.get("number"))));

  // One product per distinct product title + spine colours. Same title with
  // different colours = separate copies (e.g. The Lovely Bones DVD and Blu-ray).
  type Group = { title: string; colours: string[]; rows: typeof sfRows };
  const groupsByKey = new Map<string, Group>();
  const unknownMedia: string[] = [];
  for (const r of sfRows) {
    const title = clean(r.get("product_title"));
    const colours = ["spine_colour_1", "spine_colour_2", "spine_colour_3"]
      .map((c) => clean(r.get(c)))
      .filter(Boolean)
      .map(titleCase);
    const key = `${title}\u0000${colours.join("/")}`;
    const g = groupsByKey.get(key);
    if (g) g.rows.push(r);
    else groupsByKey.set(key, { title, colours, rows: [r] });
  }
  const groups = [...groupsByKey.values()];

  const typeCounts = { film: 0, tv_season: 0, episode: 0 };
  for (const g of groups) {
    const [p] = await db
      .insert(products)
      .values({ title: g.title, spineColours: g.colours, location: "shelf" })
      .returning({ id: products.id });
    await db.insert(items).values(
      g.rows.map((r, i) => {
        const title = clean(r.get("film_title"));
        const year = toYear(r.get("film_release_year"));
        const rawFormat = clean(r.get("product_format"));
        const format = MEDIA_FORMATS[fold(rawFormat)];
        if (!format) unknownMedia.push(`row ${clean(r.get("number"))}: "${rawFormat}"`);
        const itemType = itemTypeFor(title);
        typeCounts[itemType]++;
        return {
          productId: p.id,
          legacyNumber: Number(clean(r.get("number"))),
          position: i + 1,
          title,
          releaseYear: year,
          itemType,
          format: format ?? "Blu Ray",
          watchedBeforeLogging: toFlag(r.get("watched_status")),
          matchKey: matchKey(title, year),
        };
      }),
    );
  }

  // ---- watches
  const wRows = await readSheet(WATCHES_XLSX);
  const newFormats = new Map<string, number>();
  const badDates: string[] = [];
  const watchValues = [];
  for (const r of wRows) {
    const title = clean(r.get("film_name"));
    const year = toYear(r.get("film_release_year"));
    const watchedOn = toIsoDate(r.get("timestamp_watched"));
    if (!watchedOn) {
      badDates.push(`row ${r.row}: ${title} "${clean(r.get("timestamp_watched"))}"`);
      continue;
    }
    const rawFormat = clean(r.get("Format"));
    let fmt = formatByKey.get(fold(rawFormat));
    if (!fmt) {
      const [created] = await db
        .insert(viewingFormats)
        .values({ name: rawFormat || "Unknown", kind: "other" })
        .returning();
      formatByKey.set(fold(rawFormat), created);
      fmt = created;
    }
    if (fmt.kind === "other" && !SEED_FORMATS.some((s) => s.name === fmt!.name)) {
      newFormats.set(fmt.name, (newFormats.get(fmt.name) ?? 0) + 1);
    }
    watchValues.push({
      legacyRow: r.row,
      title,
      releaseYear: year,
      watchedOn,
      formatId: fmt.id,
      formatFromMemory: watchedOn < FORMAT_FROM_MEMORY_BEFORE,
      matchKey: matchKey(title, year),
    });
  }
  const insertedWatches = [];
  for (let i = 0; i < watchValues.length; i += 500) {
    insertedWatches.push(
      ...(await db.insert(watches).values(watchValues.slice(i, i + 500)).returning()),
    );
  }

  // ---- review flags
  const allItems = await db.select().from(items);
  const formatById = new Map(formatRows.map((f) => [f.id, f]));
  for (const f of formatByKey.values()) formatById.set(f.id, f);

  const itemsByKey = new Map<string, typeof allItems>();
  for (const it of allItems) {
    if (it.itemType !== "film") continue;
    itemsByKey.set(it.matchKey, [...(itemsByKey.get(it.matchKey) ?? []), it]);
  }
  const flags: (typeof reviewFlags.$inferInsert)[] = [];

  // Disc watch in a format you don't own that film in.
  for (const w of insertedWatches) {
    const fmt = formatById.get(w.formatId)!;
    if (fmt.kind !== "disc") continue;
    const owned = itemsByKey.get(w.matchKey);
    if (!owned) continue;
    const played = DISC_TO_MEDIA[fmt.name];
    if (!owned.some((it) => it.format === played)) {
      flags.push({
        kind: "format_mismatch",
        itemId: owned[0].id,
        watchId: w.id,
        detail: `${w.title} watched on ${fmt.name} (${w.watchedOn}); you own it on ${[...new Set(owned.map((o) => o.format))].join(", ")}`,
      });
    }
  }

  // Owned film whose title appears in the log only with a different year.
  const watchYearsByTitle = new Map<string, Set<number | null>>();
  for (const w of insertedWatches) {
    const t = normaliseTitle(w.title);
    watchYearsByTitle.set(t, (watchYearsByTitle.get(t) ?? new Set()).add(w.releaseYear));
  }
  const watchKeys = new Set(insertedWatches.map((w) => w.matchKey));
  for (const it of allItems) {
    if (it.itemType !== "film" || watchKeys.has(it.matchKey)) continue;
    const years = watchYearsByTitle.get(normaliseTitle(it.title));
    if (years) {
      flags.push({
        kind: "title_near_miss",
        itemId: it.id,
        detail: `${it.title} (${it.releaseYear}) in SpineFind; the watch log has ${[...years].map((y) => y ?? "no year").join(", ")}`,
      });
    }
  }

  for (const w of insertedWatches) {
    if (w.releaseYear == null) {
      flags.push({ kind: "missing_year", watchId: w.id, detail: `${w.title} watched ${w.watchedOn} has no release year` });
    }
  }
  for (const [name, n] of newFormats) {
    flags.push({ kind: "new_format", detail: `"${name}" isn't a known format (${n} watches); set its kind in the app` });
  }
  if (flags.length) await db.insert(reviewFlags).values(flags);

  // ---- watched status summary
  const status = await client.query<{ was: boolean; now: boolean | null; n: number }>(`
    select i.watched_before_logging as was, s.watched as now, count(*)::int as n
    from items i join item_watch_status s on s.item_id = i.id
    group by 1, 2 order by 1, 2`);
  const gained = await client.query<{ title: string; release_year: number }>(`
    select i.title, i.release_year from items i join item_watch_status s on s.item_id = i.id
    where i.item_type = 'film' and not i.watched_before_logging and s.watched
    order by i.legacy_number`);

  // ---- report
  const fmtCounts = await client.query<{ name: string; kind: string; n: number }>(`
    select f.name, f.kind, count(w.id)::int as n from viewing_formats f
    left join watches w on w.format_id = f.id group by f.id order by n desc, f.name`);
  const memory = insertedWatches.filter((w) => w.formatFromMemory).length;

  say(`# Import report`);
  say();
  say(`Run ${new Date().toLocaleString("en-GB")}.`);
  say(`Sources: \`${path.basename(SPINEFIND_XLSX)}\` and \`${path.basename(WATCHES_XLSX)}\`.`);
  say();
  say(`## Catalogue`);
  say(`- ${sfRows.length} rows → **${groups.length} products** holding **${allItems.length} items**`);
  say(`- Items: ${typeCounts.film} films, ${typeCounts.tv_season} TV seasons, ${typeCounts.episode} episodes`);
  say(`- Box sets (more than one item): ${groups.filter((g) => g.rows.length > 1).length}`);
  if (unknownMedia.length) say(`- ⚠ Unrecognised product formats (imported as Blu Ray): ${unknownMedia.join("; ")}`);
  say();
  say(`## Watch log`);
  say(`- **${insertedWatches.length} watches** imported, ${memory} marked "format from memory" (before ${FORMAT_FROM_MEMORY_BEFORE})`);
  if (badDates.length) say(`- ⚠ Skipped, unreadable date: ${badDates.join("; ")}`);
  say();
  say(`| Format | Kind | Watches |`);
  say(`|---|---|---|`);
  for (const f of fmtCounts.rows) say(`| ${f.name} | ${f.kind} | ${f.n} |`);
  say();
  say(`## Watched status (films)`);
  say();
  say(`| Old flag | Now | Items |`);
  say(`|---|---|---|`);
  for (const s of status.rows) {
    say(`| ${s.was ? "1" : "0"} | ${s.now === null ? "n/a (TV)" : s.now ? "watched" : "not watched"} | ${s.n} |`);
  }
  say();
  say(`Newly watched from disc watches in the log (${gained.rows.length}):`);
  for (const g of gained.rows) say(`- ${g.title} (${g.release_year})`);
  say();
  say(`## Review flags (${flags.length})`);
  for (const kind of ["format_mismatch", "title_near_miss", "missing_year", "new_format"] as const) {
    const list = flags.filter((f) => f.kind === kind);
    if (!list.length) continue;
    say();
    say(`### ${kind} (${list.length})`);
    for (const f of list) say(`- ${f.detail}`);
  }

  mkdirSync(path.dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, report.join("\n") + "\n", "utf8");
  await client.close();
  console.log(report.slice(0, 12).join("\n"));
  console.log(`\nFull report: ${path.relative(ROOT, REPORT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
