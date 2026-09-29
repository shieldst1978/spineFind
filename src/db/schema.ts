import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  pgView,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const location = pgEnum("location", ["shelf", "loft", "gone"]);
export const itemType = pgEnum("item_type", ["film", "tv_season", "episode"]);
export const mediaFormat = pgEnum("media_format", ["4K UltraHD", "Blu Ray", "DVD", "HD DVD"]);
export const formatKind = pgEnum("format_kind", ["disc", "cinema", "streaming", "tv", "download", "other"]);
export const flagKind = pgEnum("flag_kind", [
  "format_mismatch",
  "title_near_miss",
  "missing_year",
  "tmdb_unmatched",
  "new_format",
]);
export const flagStatus = pgEnum("flag_status", ["open", "resolved", "dismissed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** A box on the shelf: the spine you look for. */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    spineColours: text("spine_colours").array().notNull(),
    location: location("location").notNull().default("shelf"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("products_title_idx").on(t.title)],
);

/** A film, TV season or episode inside a box. */
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    legacyNumber: integer("legacy_number"),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    releaseYear: integer("release_year"),
    itemType: itemType("item_type").notNull().default("film"),
    format: mediaFormat("format").notNull(),
    watchedBeforeLogging: boolean("watched_before_logging").notNull().default(false),
    matchKey: text("match_key").notNull(),
    tmdbId: integer("tmdb_id"),
    ...timestamps,
  },
  (t) => [
    index("items_product_idx").on(t.productId),
    index("items_match_key_idx").on(t.matchKey),
    uniqueIndex("items_legacy_number_idx").on(t.legacyNumber),
  ],
);

/** Where a watch happened. User-editable; `kind` decides what counts as a disc watch. */
export const viewingFormats = pgTable("viewing_formats", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  kind: formatKind("kind").notNull(),
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
});

/** One row per viewing. */
export const watches = pgTable(
  "watches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyRow: integer("legacy_row"),
    title: text("title").notNull(),
    releaseYear: integer("release_year"),
    watchedOn: date("watched_on").notNull(),
    formatId: integer("format_id")
      .notNull()
      .references(() => viewingFormats.id),
    formatFromMemory: boolean("format_from_memory").notNull().default(false),
    matchKey: text("match_key").notNull(),
    tmdbId: integer("tmdb_id"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("watches_match_key_idx").on(t.matchKey), index("watches_watched_on_idx").on(t.watchedOn)],
);

/** TMDB details, fetched once and shared by items and watches. */
export const films = pgTable("films", {
  tmdbId: integer("tmdb_id").primaryKey(),
  imdbId: text("imdb_id"),
  title: text("title").notNull(),
  originalTitle: text("original_title"),
  releaseDate: date("release_date"),
  runtimeMinutes: integer("runtime_minutes"),
  directors: text("directors").array(),
  genres: text("genres").array(),
  posterPath: text("poster_path"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Things for the user to check. Dismissed flags are not raised again. */
export const reviewFlags = pgTable("review_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: flagKind("kind").notNull(),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
  watchId: uuid("watch_id").references(() => watches.id, { onDelete: "cascade" }),
  detail: text("detail").notNull(),
  status: flagStatus("status").notNull().default("open"),
  ...timestamps,
});

/**
 * Watched status per item. Films count as watched if flagged before logging or
 * if a watch of the same title + year was on a disc format. TV items are null.
 */
export const itemWatchStatus = pgView("item_watch_status", {
  itemId: uuid("item_id").notNull(),
  watched: boolean("watched"),
  discWatchCount: integer("disc_watch_count").notNull(),
  lastDiscWatch: date("last_disc_watch"),
}).as(sql`
  select
    i.id as item_id,
    case
      when i.item_type <> 'film' then null
      else i.watched_before_logging or count(w.id) > 0
    end as watched,
    count(w.id)::int as disc_watch_count,
    max(w.watched_on) as last_disc_watch
  from items i
  left join watches w
    on w.match_key = i.match_key
    and w.format_id in (select id from viewing_formats where kind = 'disc')
  group by i.id
`);
