/**
 * Reads the film libraries of the Plex Media Server on this PC and makes SpineFind's Plex boxes match
 * (src/db/plex.ts has the rules). Run it through scripts/ops/run-plex-sync.ps1, which finds the Plex token.
 *
 *   PLEX_TOKEN=… DATABASE_URL=… npx tsx --conditions=react-server scripts/plex-sync.ts --cloud [--dry-run] [--production]
 *
 * PLEX_URL defaults to http://127.0.0.1:32400. The token is only ever sent to that server.
 */
import { createDb } from "../src/db/client";
import { enrichFilms } from "../src/db/film-link";
import { syncPlexFilms, type PlexFilm } from "../src/db/plex";

const flags = new Set(process.argv.slice(2));
const PLEX = process.env.PLEX_URL ?? "http://127.0.0.1:32400";

type Guid = { id: string };
type PlexVideo = { guid: string; title: string; year?: number; Guid?: Guid[]; Media?: { videoResolution?: string; height?: number }[] };

async function plex<T>(path: string): Promise<T> {
  const res = await fetch(`${PLEX}${path}`, { headers: { Accept: "application/json", "X-Plex-Token": process.env.PLEX_TOKEN! } });
  if (!res.ok) throw new Error(`Plex ${path}: ${res.status} ${res.statusText}`);
  return ((await res.json()) as { MediaContainer: T }).MediaContainer;
}

async function readPlex(): Promise<PlexFilm[]> {
  const { Directory = [] } = await plex<{ Directory?: { key: string; type: string; title: string }[] }>("/library/sections");
  const films: PlexFilm[] = [];
  for (const section of Directory.filter((d) => d.type === "movie")) {
    const { Metadata = [] } = await plex<{ Metadata?: PlexVideo[] }>(`/library/sections/${section.key}/all?type=1&includeGuids=1`);
    console.log(`Plex library "${section.title}": ${Metadata.length} films`);
    for (const v of Metadata) {
      const ext = (scheme: string) => v.Guid?.find((g) => g.id.startsWith(`${scheme}://`))?.id.slice(scheme.length + 3) ?? null;
      const tmdb = Number(ext("tmdb"));
      // The best copy when there are several versions of the film.
      const best = [...(v.Media ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
      films.push({
        guid: v.guid, title: v.title, year: v.year ?? null,
        tmdbId: Number.isInteger(tmdb) && tmdb > 0 ? tmdb : null, imdbId: ext("imdb"),
        resolution: best?.videoResolution ?? null,
      });
    }
  }
  // The same film in two libraries counts once.
  return [...new Map(films.map((f) => [f.guid, f])).values()];
}

async function main() {
  if (!process.env.PLEX_TOKEN) throw new Error("PLEX_TOKEN is not set");
  if (!process.env.TMDB_READ_TOKEN) throw new Error("TMDB_READ_TOKEN is not set");
  const { kind, migrate, client } = createDb();
  if (kind !== "postgres" || !flags.has("--cloud")) throw new Error("Run against a hosted database with DATABASE_URL set and --cloud.");
  const host = new URL(process.env.DATABASE_URL!).hostname;
  if (process.env.NEON_PROD_DATABASE_URL && new URL(process.env.NEON_PROD_DATABASE_URL).hostname === host && !flags.has("--production")) {
    throw new Error(`DATABASE_URL is the production database (${host}). Add --production to really run against it.`);
  }
  const dryRun = flags.has("--dry-run");
  const films = await readPlex();
  console.log(`${dryRun ? "Dry run (nothing saved) against" : "Syncing into"} ${host}`);
  if (!dryRun) await migrate("./drizzle");
  await client.close();

  const { newTmdbIds, unlinked, ...counts } = await syncPlexFilms(films, { dryRun });
  console.log("result:", JSON.stringify({ ...counts, unlinked: unlinked.length }));
  if (unlinked.length) console.log("not linked to TMDB:", unlinked.join("; "));
  if (!dryRun && newTmdbIds.length) {
    await enrichFilms(newTmdbIds);
    console.log(`fetched TMDB records for ${newTmdbIds.length} new films`);
  }
}

main().then(() => process.exit(0), (e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
