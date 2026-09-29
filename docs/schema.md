# SpineFind database schema (draft)

Status: **draft for review**, 28/09/2026. The target database is PostgreSQL (PGlite locally, Azure Database for PostgreSQL in production).

## Overview

```
products ──< items            a box on the shelf holds one or more films or seasons
watches  >── viewing_formats  each watch has a format (Blu Ray, Sky, Cinema, ...)
items    ··· watches          linked by match_key (normalised title + year), not a stored ID
films                         TMDB details (directors, genres, poster), shared by items and watches
review_flags                  anything for you to check (format mismatches, near-miss titles, ...)
```

## Tables

### `products`: a box on the shelf (the spine you look for)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `title` | text | From `product_title`, e.g. *Bruce Lee at Golden Harvest* |
| `spine_colours` | text[] (1–3) | In order, e.g. `{Black, Orange, Cream}`. The first colour is the dominant one. |
| `location` | enum: `shelf`, `loft`, `gone` | Every row imported from the spreadsheet starts as `shelf` |
| `notes` | text, optional | |
| `created_at`, `updated_at` | timestamptz | `updated_at` drives the OneDrive sync later |

Spine colours and location belong to the box, because they're what you see on the shelf.

### `items`: a film or season inside a box

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `product_id` | → products | |
| `legacy_number` | int | The spreadsheet's `number` column, kept so you can cross-reference |
| `position` | int | Order within the box |
| `title` | text | From `film_title` |
| `release_year` | int | |
| `item_type` | enum: `film`, `tv_season`, `episode` | Worked out from "Season", "Series" or "Episode" in the title during import |
| `format` | enum: `4K UltraHD`, `Blu Ray`, `DVD`, `HD DVD` | Per item, because some box sets mix formats (Bruce Lee, the Mexico Trilogy) |
| `watched_before_logging` | bool | From the old `watched_status` column: 1 → true. It keeps "seen at some point" for films with no disc watch logged. |
| `match_key` | text, generated | Normalised title + year, e.g. `godfather\|1972` |
| `tmdb_id` | int, optional | Set during the TMDB matching step |

**Watched status isn't stored. It's worked out from the other tables:**
- **Films:** watched = `watched_before_logging` OR a watch with the same `match_key` on a disc format.
- **TV seasons and episodes:** not applicable. The watch log covers films only.

The spreadsheet's `watched_status` column is written from this calculation.

### `watches`: one row per viewing

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `title` | text | From `film_name` |
| `release_year` | int, optional | Two rows currently have none (to be filled from TMDB) |
| `watched_on` | date | No time of day |
| `format_id` | → viewing_formats | |
| `format_from_memory` | bool | True for watches before 23/01/2026, because aNote didn't record format and you filled it in later |
| `match_key` | text, generated | Same normalisation as `items` |
| `tmdb_id` | int, optional | |
| `notes` | text, optional | |
| `created_at`, `updated_at` | timestamptz | |

### `viewing_formats`: the tidy list of where you watched something

| Column | Type | Notes |
|---|---|---|
| `id` | serial | |
| `name` | text, unique | e.g. `Sky`, `Blu Ray`, `Cinema`, `Plex` |
| `kind` | enum: `disc`, `cinema`, `streaming`, `tv`, `download`, `other` | |
| `aliases` | text[] | Spellings the import folds in, e.g. `{sky}`, `{4k Blu Ray}`, `{plane}` |

Only `disc` formats count towards watched status: **Blu Ray, DVD, 4K Blu Ray and HD DVD**. Plex is a normal watch format of kind `streaming`, so it doesn't count.

Starting list, from the 44 spellings in your log:

| Kind | Formats |
|---|---|
| disc | Blu Ray, 4K Blu Ray, DVD, HD DVD |
| cinema | Cinema, BFI IMAX |
| streaming | Netflix, Amazon Prime Video, Disney +, Love Film, Plex, Paramount +, Apple TV + (also covers *Apple TV*), Mubi, Arrow Player, BFI Player, HBO Max, YouTube, ITVX, BBC iPlayer, Fawesome, Stream |
| tv | Sky, Sky Movies (a format of its own), Sky One, Sky Arts, Sky Documentaries, Film 4, Channel 4, BBC One, ITV, ITV4, Comedy Central, TV |
| download | Download |
| other | Plane |

**Adding formats:** the list lives in this table, not in the code, so you can add, rename or merge formats from the app. When you log a watch, you pick a format from the list or type a new one. A new format asks for its kind, which decides whether it counts as a disc watch. Merging moves every watch from one format to the other and keeps the old name as an alias. If the import finds a spelling it doesn't recognise, it creates the format and flags it for review instead of failing.

### `films`: TMDB details, fetched once and reused

| Column | Type | Notes |
|---|---|---|
| `tmdb_id` | int, primary key | |
| `imdb_id` | text | For links out to IMDb |
| `title`, `original_title` | text | |
| `release_date` | date | |
| `runtime_minutes` | int | |
| `directors` | text[] | Powers stats such as the Spielberg summer |
| `genres` | text[] | |
| `poster_path` | text | |
| `fetched_at` | timestamptz | |

This table doesn't affect matching, which stays on title + year as you decided. It's there for artwork, auto-filled release years and stats.

### `review_flags`: your to-check list in the app

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `kind` | enum | `format_mismatch` (disc watch in a different format from any copy you own), `title_near_miss` (title matches but year differs), `missing_year`, `tmdb_unmatched`, `new_format` (a format spelling the import didn't recognise) |
| `item_id`, `watch_id` | optional references | |
| `detail` | text | |
| `status` | enum: `open`, `resolved`, `dismissed` | Dismissing keeps it from coming back |

## Import rules

1. **Grouping rows into boxes.** Rows with the same `product_title` and the same spine colours become one product, even if the rows aren't next to each other. That keeps separate copies apart, such as the DVD and Blu-ray of *The Lovely Bones* and the two *Dune* rows, while still grouping box sets.
2. **Dropped:** the `Column1` shelf-count marks.
3. **Tidied:** spine colour spacing, and format spellings folded into `viewing_formats`.
4. **Nothing is lost:** each spreadsheet row keeps its original number or row position, so the import report can point back to it.
5. **Re-runnable:** the import rebuilds the database from the two spreadsheets. Until the app is in daily use, you can keep editing the spreadsheets and re-import.

## Later, not part of this draft

- A TV watch log (the same `watches` table, with an `item_type`)
- OneDrive two-way sync (it will use `updated_at` plus an `id` column added to each sheet)
- Spine photo identification and barcode scanning
