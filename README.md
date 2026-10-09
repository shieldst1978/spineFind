# SpineFind

A personal catalogue of the films on my shelves, searchable by spine colour, and a log of every film I watch.

**Live:** https://tim-shields.com/spinefind (Microsoft sign-in, one allowed account)

- [What it does](#what-it-does)
- [How it fits together](#how-it-fits-together)
- [Tech stack](#tech-stack)
- [Code map](#code-map)
- [Data model](#data-model)
- [Key rules](#key-rules)
- [Environments and configuration](#environments-and-configuration)
- [Local development](#local-development)
- [Deploying](#deploying)
- [Running it](#running-it)
- [The spreadsheet import](#the-spreadsheet-import)
- [Gotchas](#gotchas)

## What it does

| Page | Path | What it's for |
|---|---|---|
| **Shelf** | `/spinefind` | Find a box by title (typo-tolerant) or by the spine colours you can see; filter by format, location (shelf / loft / gone) and watched status. Each box is drawn as a spine in its colours. |
| **Add** | `/spinefind/add` | Add a box: its films first (with TMDB suggestions), then the box title (defaults to the first film), spine colours and where it's kept. One form covers single films and box sets. |
| **Box edit** | `/spinefind/box/<id>` | Change a box's title, spine, location and films (fix, add, remove); delete the box with a two-tap confirmation. |
| **Film page** | `/spinefind/item/<id>` | A film in a box: watched status, TMDB details (director, top cast, genres, UK certificate and release date, "also known as"), "I watched this" (defaults to the copy's disc format), "Seen before, no date", watch history with edit links. |
| **Watches** | `/spinefind/watches` | The watch log as a table: release decade, age when watched, rewatch count ("2nd of 6"), owned copy, format. Filter, sort, page; summary cards for the filtered set. |
| **Log a watch** | `/spinefind/watches/new` | Log any film, owned or not. Suggestions come from your log, shelf and TMDB; picking a film you own sets the format to your copy. New viewing formats can be added inline. |
| **Watch edit** | `/spinefind/watches/<id>` | Correct a watch's title, year, date or format, or delete it (two taps). Works for imported watches too. |
| **Pick** | `/spinefind/pick` | Choose a film to watch at random: unwatched / rewatch / anything, by decade (or a random "surprise" decade), format, spine colour, "not seen in N years". Shows TMDB details and which spine to look for. |
| **Settings** | `/spinefind/settings` (footer link) | Tick the UK streaming services you subscribe to. Film pages then show "Where to watch in the UK", with your services first. |
| **Review** | `/spinefind/review` | Films the TMDB matcher wasn't sure about, most-used first: pick the right one (optionally correcting your year to TMDB's), search TMDB yourself, or say "None of these". |

## How it fits together

```
 iPhone Safari / browser
        │  https://tim-shields.com/spinefind
        ▼
 GoDaddy DNS ── A @ → 20.108.204.58, TXT asuid (domain verification)
        │
        ▼
 Azure Container Apps  (resource group SpineFind, UK South)
 ┌──────────────────────────────────────────────────────────────┐
 │ environment: spinefind-env            app: spinefind         │
 │                                                              │
 │  Microsoft sign-in (Container Apps "Easy Auth")              │
 │   • not signed in → login.microsoftonline.com                │
 │   • only the one assigned account can sign in (Entra ID)     │
 │   • adds x-ms-client-principal-name to each request          │
 │        │                                                     │
 │        ▼                                                     │
 │  Next.js server (container, port 3000)                       │
 │   src/proxy.ts  second check: user must be in               │
 │                 AUTH_ALLOWED_USERS                           │
 │   pages + server actions  → src/db (Drizzle, SQL)            │
 └──────────────┬─────────────────────────────┬─────────────────┘
                │ Postgres (TLS)              │ HTTPS
                ▼                             ▼
      Neon Postgres (AWS London)       TMDB API (film search,
      production branch = live data    details, posters)

 Code → GitHub (shieldst1978/spineFind, private)
      → GitHub Actions builds the container image on every push to main
      → ghcr.io/shieldst1978/spinefind:<git sha>
      → `az containerapp update --image …` switches the live app to it
```

A request, end to end: Safari asks for `/spinefind/watches`. Azure's sign-in layer checks the session cookie, sending you to Microsoft if there isn't one. It then passes the request to the Next.js container with your identity in a header. `src/proxy.ts` checks that identity against the allowed list, the page's server component queries Neon through Drizzle, and the rendered HTML comes back. Forms (saving, deleting, logging) and the as-you-type suggestions are **server actions**: functions in `actions.ts` files that run on the server and are called directly by forms or client components.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router, React 19, TypeScript) | Server components for pages, server actions for writes, `basePath: /spinefind`, standalone output for the container. Next 16 calls middleware "Proxy" (`src/proxy.ts`). |
| Styling | **Tailwind CSS 4** | Mobile-first; light and dark mode follow the phone. Form controls use 16px text on phones so iOS Safari doesn't zoom. |
| Database | **PostgreSQL**: **Neon** (hosted, free plan) | `pg_trgm` for fuzzy title search. Production and dev are separate Neon branches. |
| ORM | **Drizzle ORM** + drizzle-kit | Schema in TypeScript, SQL migrations in `drizzle/`. Complex reads are written as SQL through `db.execute(sql\`…\`)`. |
| Local DB fallback | **PGlite** (Postgres in WebAssembly) | Used only when `DATABASE_URL` isn't set. Fragile (see [Gotchas](#gotchas)); normally unused now. |
| Film data | **TMDB API** | Search, full records (top 10 billed cast, key crew, genres, keywords, UK certificate and release date, alternative titles, collection, IMDb id), posters. Stored in `films`, `people`, `film_credits`, `film_titles`. |
| Spreadsheet import | **ExcelJS** + `tsx` | One-off/rebuild import from the original `.xlsx` files. |
| Hosting | **Azure Container Apps** (consumption plan) | Scales 0–1 replicas; awake 7am–midnight UK time, wakes on demand otherwise. |
| Sign-in | **Container Apps authentication** with **Microsoft Entra ID** | App registration "SpineFind", assignment required, only Tim assigned. |
| Images | **GitHub Actions** → **GitHub Container Registry** | Azure pulls with a read-only token stored as an app secret. |
| Domain | **tim-shields.com** at GoDaddy | Apex A record to the Container Apps environment; free managed certificate. |

## Code map

```
src/
  app/                          Pages (server components) and their server actions
    layout.tsx                  Shell: nav bar, TMDB credit, icons, Home Screen name
    page.tsx                    Shelf
    add/page.tsx                Add a box (uses BoxForm + box/actions)
    box/actions.ts              addBox, updateBox, deleteBox; shared form parsing; TMDB caching of picked films
    box/[id]/page.tsx           Edit / delete a box
    item/[id]/page.tsx          Film page;  item/[id]/actions.ts: logWatch, setSeenBefore
    watches/page.tsx            Watch log table
    watches/new/page.tsx        Log a watch; watches/actions.ts: addWatch, suggestFilms
    watches/[id]/page.tsx       Edit / delete a watch; watches/[id]/actions.ts: updateWatch, deleteWatch
    pick/page.tsx               Pick a film
    review/page.tsx             Review TMDB matches; review/actions.ts: confirmMatch, rejectMatch, markAsTv, reopenMatch
    settings/page.tsx           Your streaming services; settings/actions.ts: saveServices
    icon.svg, apple-icon.png    Browser and Home Screen icons (public, bypass sign-in)
  components/                   Client-side pieces
    box-form.tsx                The Add/Edit box form (films first, box title follows the first film)
    film-title-input.tsx        Title box with suggestions (yours + TMDB); used by the box form and Log a watch
    log-watch-form.tsx          Log a watch form (owned film → format set to your copy)
    edit-watch-form.tsx         Edit a watch
    shelf-filters.tsx           Shelf search and filters
    auto-submit-form.tsx        GET form that applies filters on change (Watches, Pick)
    nav.tsx, spine.tsx          Nav bar; spine drawing
  db/
    schema.ts                   Tables, enums and the item_watch_status view (source of truth for the data model)
    client.ts                   createDb(): node-postgres when DATABASE_URL is set, else PGlite; migrations
    index.ts                    Lazy shared db/client (never opened at build time); closes cleanly on shutdown
    queries.ts                  Read queries: shelf search, watch log with derived columns, film/box/watch detail, pick, decades
    suggestions.ts              Title suggestions: your films (exact/fuzzy/other titles) merged with TMDB results
    films.ts                    cacheFilm() (full TMDB record), detailsForItem() (confident title+year match only)
    film-link.ts                linkTmdbId(): a saved film inherits its title+year's TMDB link; enrichFilms()
    enrich.ts                   storeFilm(): writes a full TMDB record (film, people, credits, titles)
    streaming.ts                UK services list and your subscriptions; availabilityFor() (cached a day)
    seed-formats.ts             Starting viewing formats and aliases; disc → media format mapping
  lib/
    match-key.ts                Title normalisation and the title+year matching key
    item-type.ts                Film / TV season / episode classification from a title
    form-values.ts              Shared form parsing: text, year, date (blank = today), UUID
    tmdb.ts                     TMDB API client (search, details, full record, titles, UK release year); retries on 429/5xx
    tmdb-match.ts               matchFilm(): the matching rules (see TMDB enrichment)
    colours.ts                  Spine colour names and swatches
    base-path.ts                /spinefind and withBase() for plain HTML form actions
  proxy.ts                      Allowed-user check behind Azure sign-in; icons are public
scripts/
  import.ts                     Rebuild a database from the two spreadsheets, with a report
  enrich.ts                     Match every film to TMDB and store its full record (see TMDB enrichment)
  start.mjs                     Container entry point: run migrations, then start Next
drizzle/                        SQL migrations (0000 init, 0001 pg_trgm, 0002 TMDB enrichment tables, 0003 film_key, 0004 streaming)
docs/schema.md                  Original data-model design notes (schema.ts is authoritative)
Dockerfile, .dockerignore       Container image build (personal data and secrets excluded)
.github/workflows/build.yml     Build and push the image on every push to main
```

## Data model

| Table | What a row is | Notable columns |
|---|---|---|
| `products` | A **box** on the shelf: the spine you look for | `title`, `spine_colours` (1–3, main first), `location` (shelf / loft / gone) |
| `items` | A **film, TV season or episode** inside a box | `format` (4K UltraHD / Blu Ray / DVD / HD DVD), `release_year`, `item_type`, `watched_before_logging`, `match_key`, `tmdb_id`, `film_key`, `legacy_number` (spreadsheet row) |
| `watches` | One **viewing** | `watched_on`, `format_id`, `format_from_memory` (aNote era), `match_key`, `tmdb_id`, `film_key`, `legacy_row` (null = logged in the app) |
| `viewing_formats` | Where you watched (Sky, Cinema, Blu Ray…) | `kind` (disc / cinema / streaming / tv / download / other), `aliases` |
| `films` | A TMDB film's details | `directors`, `genres`, `keywords`, `countries`, `runtime_minutes`, `uk_certificate`, `uk_release_date`, `collection_name`, `vote_average`, `poster_path`, `imdb_id`, `enriched_at` |
| `people` | An actor or crew member | `name`, `profile_path` |
| `film_credits` | Who did what on a film | `role` (cast / crew), `job` (Director, Screenplay, Original Music Composer…), `character`, `billing` (cast order, top 10) |
| `film_titles` | Every title a film goes by | `kind` (tmdb / original / alternative), `country` (GB, US…) |
| `streaming_services` | A UK streaming / rental service (TMDB's JustWatch list, refreshed monthly) | `name`, `logo_path`, `priority`, `subscribed` (yours) |
| `film_availability` | Where a film can be watched in the UK, cached for a day | `offers` (stream / free / ads / rent / buy), `fetched_at` |
| `tmdb_matches` | The matcher's answer per title + year as entered | `status` (auto / review / confirmed / rejected / unmatched), `tmdb_id`, `method` (why), `candidates` |
| `review_flags` | Things the import wants checked | `kind`, `status` |
| `item_watch_status` (view) | Watched status per item | see below |

## Key rules

- **Which film is it?** Every box entry and watch has a `film_key`: `tmdb:<id>` once linked to TMDB, otherwise its `match_key` (normalised title + `|` + year). Normalising ignores case, accents, punctuation, spacing and a leading or trailing "The/A/An", and treats `&` as "and" (the TMDB matcher also reads Roman numerals after the first word as numbers). Joins, watch history and rewatch counts all go through `film_key`, so "Avengers Assemble" and "The Avengers (2012)" are one film, and two different films that share a title and year stay apart.
- **Your title is kept.** The app always shows the title as you entered it (as on the spine, or as you watched it). TMDB's title and the alternatives are used for search and shown as "also known as": searching "Midnight Sting" finds Diggstown.
- **Watched status is calculated, never stored.** A film counts as watched if it was flagged "seen before logging", or if it has a watch of the same film (`film_key`) in a **disc** format. TV items show as not applicable.
- **Box sets:** one `products` row with several `items`, each with its own year and format.
- **TMDB links are cautious.** A film gets a `tmdb_id` when you pick it from a suggestion, when the matcher is sure (see below), or when you confirm it on the Review page. A film typed without picking inherits the link of the same title + year already in the app. Editing a title or year by hand drops the old link (and takes the new title + year's link, if any).
- **Deleting a box** deletes its items but never watches: watches belong to the log.

## Environments and configuration

| | Where it runs | Database | Sign-in |
|---|---|---|---|
| **Live** | Azure Container Apps | Neon **production** branch | Microsoft, one account |
| **Local** | `npm run dev` on this PC (`http://localhost:3000/spinefind`) | Neon **dev** branch, a copy of production to test on | None |

Settings (never committed; `.env*` is git-ignored, see `.env.example`):

| Setting | Used by | Where it lives |
|---|---|---|
| `DATABASE_URL` | the app | `.env.local` = **dev** branch; Azure secret `database-url` = **production** |
| `NEON_PROD_DATABASE_URL` | reference / maintenance scripts only | `.env.local` |
| `TMDB_READ_TOKEN` | film lookups | `.env.local`; Azure secret `tmdb-read-token` |
| `GHCR_READ_TOKEN` | Azure pulling images (classic token, `read:packages`) | `.env.local`; Azure registry credential |
| `AUTH_ALLOWED_USERS` | `src/proxy.ts` | Azure env var (unset locally = everyone allowed) |
| `NEXT_DEPLOYMENT_ID` | version-skew protection | set at image build time to the git commit |

## Local development

Needs Node.js 20 or later.

```sh
npm install
npm run dev          # http://localhost:3000/spinefind (uses DATABASE_URL = the Neon dev branch)
npm run typecheck    # generates Next's route types, then tsc
npm run lint
```

Changing the schema: edit `src/db/schema.ts`, run `npm run db:generate`, and commit the new file in `drizzle/`. Migrations run automatically when the container starts (and when `scripts/enrich.ts` or `scripts/import.ts` run).

Write tests against the **dev** branch only. Before anything that saves, check `DATABASE_URL` and `NEON_PROD_DATABASE_URL` point at different hosts. To refresh dev from live, create a new dev branch from production in the Neon console and update `DATABASE_URL`.

## Deploying

1. Commit and `git push origin main`. GitHub Actions builds `ghcr.io/shieldst1978/spinefind:<full git sha>` in about a minute.
2. Switch the live app to the new image:
   ```sh
   az containerapp update --name spinefind --resource-group SpineFind \
     --image ghcr.io/shieldst1978/spinefind:<full git sha>
   ```
   This creates a new revision (`spinefind--000000N`). The app is in **single-revision mode**: once the new revision is healthy it takes all traffic and the previous one is retired.
3. **Rolling back:** redeploy the previous build, using the same command with the earlier commit's sha (`git log` lists them; every pushed commit has an image). It takes about a minute.

Pages left open across a deploy reload themselves: the build carries a deployment ID, and a lookup that still fails shows a Reload button.

## Running it

- **Scaling:** min 0 / max 1 replicas, with two rules: `daytime-7am-to-midnight` (cron, Europe/London, keeps one copy running) and `wake-on-request`. Outside those hours the first visit takes a few seconds while the app and the Neon database wake up.
- **Cost:** budget `spinefind-monthly` on the SpineFind resource group, £5 a month, emails at 50% and 100% actual and 100% forecast. In the portal: **SpineFind resource group → Cost Management → Cost analysis**.
- **Metrics (free):** portal → container app `spinefind` → **Monitoring → Metrics**: Requests, Replica Count, CPU, Memory. Neon: project **Monitoring** page.
- **Logs:** `az containerapp logs show -n spinefind -g SpineFind --tail 50` (paid log collection is switched off, so this streams from the running copy only).
- **Sign-in:** Entra app registration "SpineFind"; its client secret is stored as the Container Apps secret `microsoft-provider-authentication-secret` and expires two years after creation (September 2028). The icon files are excluded from sign-in so the iPhone Home Screen can fetch them.

## The spreadsheet import

`scripts/import.ts` builds a database from the original spreadsheets, `spinefind_data.xlsx` (catalogue) and `Film Data Validated 28-09-2026.xlsx` (watch log). They're kept beside the code and never committed. It was used to load Neon. **The live database is now the master copy**, so the import is only for rebuilding a test database.

- It wipes the target and reloads it, and writes `reports/import-report.md` with counts, watched-status changes and review flags.
- It refuses to write to a hosted database unless run with `--cloud`.
- It refuses to wipe titles, watches or flags added in the app that the spreadsheets lack, unless run with `--force`.
- Rules it applies: rows group into a box by product title + spine colours; "Season/Series" titles become TV seasons; `watched_status` becomes "seen before logging"; format spellings fold into `viewing_formats`; watches before 23 Jan 2026 are marked "format from memory" (aNote era).

A OneDrive sync to write app changes back to the spreadsheets is planned but not built.

## TMDB enrichment

`scripts/enrich.ts` matches every film as entered (one per `match_key`) to TMDB, stores the full record for each match, and links items and watches to it. Films added later are enriched when they're saved.

```sh
# with DATABASE_URL set (dev branch unless you mean otherwise)
npx tsx --conditions=react-server scripts/enrich.ts --cloud [--dry-run] [--rematch] [--refresh] [--production]
```

- `--dry-run` matches without saving and writes `reports/tmdb-dry-run.md`. `--rematch` re-checks everything except your decisions; `--refresh` re-fetches stored films. It refuses the production database unless `--production` is given.
- It never overwrites a **confirmed** or **rejected** match, so it's safe to re-run.
- Matching rules, in order (UK release year is the first choice for "the year"):
  1. One film with exactly your title and year → linked automatically.
  2. **Several films share the title and year → always your call** (Review page, best known first).
  3. No year recorded → review.
  4. Exact title whose **UK** release year is your year → automatic if there's only one.
  5. Year out by one → review. Released that year somewhere else → review.
  6. Known by another English title (UK, US, IE, AU, CA, NZ) or its original title, same year → automatic if only one; otherwise review.
  7. Same title, very different year, or a similar title (typos, subtitles, "Part 2" vs "II") → review.
  8. Nothing close → "not found"; the five nearest results are kept for the Review page.
- Rows that already carried one `tmdb_id` (picked in the app) are kept as **confirmed**, "already linked".

## Gotchas

- **PGlite (the local fallback) corrupts easily.** Killing the process, or installing packages while it runs, has damaged `.pglite` twice ("Aborted()" on every query). The fix is to delete `.pglite` and re-import. It's only used when `DATABASE_URL` is unset.
- **Bind server actions in server components** (`action.bind(null, id)` in the page), never inside a client component. Binding in the client crashed the dev server when showing a validation error.
- **Plain `<form action>` URLs need `withBase()`.** `<Link>` and `redirect()` add `/spinefind` automatically, but a no-JavaScript form post's redirect doesn't, so `next.config.ts` redirects unprefixed app paths back under `/spinefind`.
- **iOS Safari zooms into form fields with text under 16px.** Use `text-base sm:text-sm` on inputs and selects.
- **This PC's Azure CLI is an old 32-bit build.** The `containerapp` extension won't install (the core commands are enough), passing values containing `&` through `az.cmd` truncates them (call its `python.exe -IBm azure.cli` directly for secrets), and log streaming needs `python.exe -X utf8`.
- **Headless-browser screenshots can't go below about 480px wide in desktop mode.** Use device emulation to check phone layouts.
