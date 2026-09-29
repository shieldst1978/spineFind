# SpineFind

A personal catalogue of the films on my shelves (find them by spine colour) and a log of every film I watch.

## Local setup

Needs Node.js 20 or later. The database is PostgreSQL running in-process via [PGlite](https://pglite.dev), stored in `.pglite/`, so there's nothing else to install.

```sh
npm install
npm run import      # build the database from the two spreadsheets
npm run dev         # http://localhost:3000
```

## Data

The source of truth for now is the two spreadsheets in the project folder. They're kept out of git:

- `spinefind_data.xlsx`: the catalogue
- `Film Data Validated 28-09-2026.xlsx`: the watch log

`npm run import` wipes the database and rebuilds it from these files, then writes `reports/import-report.md`: counts, watched-status changes and anything to review. Re-run it whenever you edit the spreadsheets.

See [docs/schema.md](docs/schema.md) for the data model and import rules.

## Scripts

| Script | What it does |
|---|---|
| `npm run import` | Rebuild the local database from the spreadsheets |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
