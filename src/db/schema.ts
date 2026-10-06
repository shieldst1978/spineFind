import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  real,
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

/**
 * Which film a box entry or watch is: its TMDB film once linked, otherwise the
 * title + year as entered. Joins and rewatch counts go through this, so two
 * spellings linked to the same TMDB film count as one film.
 */
const filmKeySql = sql`coalesce('tmdb:' || tmdb_id::text, match_key)`;

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
    filmKey: text("film_key").generatedAlwaysAs(filmKeySql),
    ...timestamps,
  },
  (t) => [
    index("items_product_idx").on(t.productId),
    index("items_match_key_idx").on(t.matchKey),
    index("items_film_key_idx").on(t.filmKey),
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
    filmKey: text("film_key").generatedAlwaysAs(filmKeySql),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("watches_match_key_idx").on(t.matchKey),
    index("watches_film_key_idx").on(t.filmKey),
    index("watches_watched_on_idx").on(t.watchedOn),
  ],
);

/** TMDB details, fetched once and shared by items and watches. */
export const films = pgTable("films", {
  tmdbId: integer("tmdb_id").primaryKey(),
  imdbId: text("imdb_id"),
  title: text("title").notNull(),
  originalTitle: text("original_title"),
  releaseDate: date("release_date"),
  /** First UK release (cinema, else any), which often differs from the first release worldwide. */
  ukReleaseDate: date("uk_release_date"),
  runtimeMinutes: integer("runtime_minutes"),
  directors: text("directors").array(),
  genres: text("genres").array(),
  posterPath: text("poster_path"),
  overview: text("overview"),
  keywords: text("keywords").array(),
  /** ISO 3166-1 codes of the production countries, e.g. {US} or {HK}. */
  countries: text("countries").array(),
  /** ISO 639-1 code of the original language, e.g. "en", "cn". */
  originalLanguage: text("original_language"),
  /** UK (BBFC) certificate, e.g. "15", "18". */
  ukCertificate: text("uk_certificate"),
  collectionId: integer("collection_id"),
  collectionName: text("collection_name"),
  voteAverage: real("vote_average"),
  voteCount: integer("vote_count"),
  /** Set when the full record (credits, keywords, titles) has been stored. */
  enrichedAt: timestamp("enriched_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/** An actor or crew member, stored once and linked to every film they're credited on. */
export const people = pgTable("people", {
  tmdbPersonId: integer("tmdb_person_id").primaryKey(),
  name: text("name").notNull(),
  profilePath: text("profile_path"),
});

export const creditRole = pgEnum("credit_role", ["cast", "crew"]);

/** Who was in or made a film: the top-billed cast plus key crew (director, writers, composer, cinematographer, editor). */
export const filmCredits = pgTable(
  "film_credits",
  {
    id: serial("id").primaryKey(),
    tmdbId: integer("tmdb_id").notNull().references(() => films.tmdbId, { onDelete: "cascade" }),
    personId: integer("person_id").notNull().references(() => people.tmdbPersonId, { onDelete: "cascade" }),
    role: creditRole("role").notNull(),
    /** "Actor" for cast; the TMDB job for crew, e.g. "Director", "Screenplay". */
    job: text("job").notNull(),
    character: text("character"),
    /** Billing order for cast (0 = top billed). */
    billing: integer("billing"),
  },
  (t) => [
    uniqueIndex("film_credits_unique_idx").on(t.tmdbId, t.personId, t.role, t.job),
    index("film_credits_person_idx").on(t.personId),
  ],
);

/** Every title a film is known by: TMDB's (UK) title, the original title, and alternative titles by country. */
export const filmTitles = pgTable(
  "film_titles",
  {
    id: serial("id").primaryKey(),
    tmdbId: integer("tmdb_id").notNull().references(() => films.tmdbId, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** "tmdb" | "original" | "alternative" */
    kind: text("kind").notNull(),
    /** ISO 3166-1 country for alternative titles (GB, US, …). */
    country: text("country"),
  },
  (t) => [uniqueIndex("film_titles_unique_idx").on(t.tmdbId, t.title, t.country), index("film_titles_tmdb_idx").on(t.tmdbId)],
);

export const matchStatus = pgEnum("match_status", ["auto", "review", "confirmed", "rejected", "unmatched"]);

/**
 * How each film as you entered it (normalised title + year) was matched to TMDB.
 * auto = exact title + year; review = a likely candidate for you to confirm;
 * confirmed = you picked it (or picked it from suggestions); rejected = none of the
 * candidates was right; unmatched = nothing found.
 */
export const tmdbMatches = pgTable("tmdb_matches", {
  matchKey: text("match_key").primaryKey(),
  /** The title as you entered it (most common spelling) and its year. */
  title: text("title").notNull(),
  releaseYear: integer("release_year"),
  status: matchStatus("status").notNull(),
  tmdbId: integer("tmdb_id"),
  /** Why it matched, e.g. "exact", "alternative title (GB)", "year +1". */
  method: text("method"),
  /** Candidates to choose from when reviewing: [{ tmdbId, title, year, via, posterPath }]. */
  candidates: jsonb("candidates"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
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
    on w.film_key = i.film_key
    and w.format_id in (select id from viewing_formats where kind = 'disc')
  group by i.id
`);
