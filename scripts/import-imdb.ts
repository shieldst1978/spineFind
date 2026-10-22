/**
 * Imports an IMDb watch-history (or ratings) CSV as "films seen" from the command line. The same import
 * runs from Settings → IMDb in the app; see src/db/imdb.ts for the rules.
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/import-imdb.ts --cloud [--dry-run] [--production] [file.csv]
 */
import { readFileSync } from "node:fs";
import { createDb } from "../src/db/client";
import { enrichFilms } from "../src/db/film-link";
import { importSeenFromImdb } from "../src/db/imdb";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const file = args.find((a) => !a.startsWith("--")) ?? "imdb_exports/imdb_watch_history.csv";

async function main() {
  if (!process.env.TMDB_READ_TOKEN) throw new Error("TMDB_READ_TOKEN is not set");
  const { kind, migrate, client } = createDb();
  if (kind !== "postgres" || !flags.has("--cloud")) throw new Error("Run against a hosted database with DATABASE_URL set and --cloud.");
  const host = new URL(process.env.DATABASE_URL!).hostname;
  if (process.env.NEON_PROD_DATABASE_URL && new URL(process.env.NEON_PROD_DATABASE_URL).hostname === host && !flags.has("--production")) {
    throw new Error(`DATABASE_URL is the production database (${host}). Add --production to really run against it.`);
  }
  const dryRun = flags.has("--dry-run");
  console.log(`${dryRun ? "Dry run (nothing saved) against" : "Importing into"} ${host} from ${file}`);
  if (!dryRun) await migrate("./drizzle");
  await client.close();

  const r = await importSeenFromImdb(readFileSync(file, "utf8"), { dryRun });
  const { newTmdbIds, sample, ...counts } = r;
  console.log("result:", JSON.stringify(counts));
  console.log(dryRun ? "would mark, e.g.:" : "marked, e.g.:", sample.join("; "));
  if (!dryRun && newTmdbIds.length) {
    await enrichFilms(newTmdbIds);
    console.log(`fetched TMDB records for ${newTmdbIds.length} new films`);
  }
}

main().then(() => process.exit(0), (e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
