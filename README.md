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

**Titles added in the app** (with **+ Add**) aren't written back to the spreadsheet yet; that comes with the OneDrive sync. The import refuses to run while the app holds titles the spreadsheet lacks, and lists them with their numbers so you can copy them across. `npm run import -- --force` discards them instead.

**Stop the dev server before running the import.** PGlite allows only one process at a time to open the `.pglite` folder.

**Stop the dev server with Ctrl+C**, which closes the database cleanly. Killing the process outright (Task Manager, `taskkill /f`) can corrupt `.pglite`. If that happens, the database won't open ("Aborted()"). Delete `.pglite` and run `npm run import` to rebuild it. Anything added in the app since the last import would be lost, which is another reason the OneDrive sync matters. Production will use Azure Database for PostgreSQL, which doesn't have this weakness.

See [docs/schema.md](docs/schema.md) for the data model and import rules.

## Scripts

| Script | What it does |
|---|---|
| `npm run import` | Rebuild the local database from the spreadsheets |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
