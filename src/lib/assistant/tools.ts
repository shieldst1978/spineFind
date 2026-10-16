import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { runReadOnlyQuery } from "@/db/assistant";
import { availabilityFor, listServices } from "@/db/streaming";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { discoverOnServices, searchMovies, TMDB_GENRES } from "@/lib/tmdb";

/** Tools the assistant can call. Web search runs on Claude's side; the rest run here. */
export const TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    name: "query_database",
    description:
      "Run one read-only PostgreSQL SELECT against Tim's SpineFind database (see the data description in the instructions). " +
      "Returns JSON with columns and rows (at most 150 rows). Use it for anything about his collection, shelf, boxes, watch log, people and genres.",
    input_schema: {
      type: "object",
      properties: { sql: { type: "string", description: "A single SELECT or WITH … SELECT statement." } },
      required: ["sql"],
    },
  },
  {
    name: "where_to_watch",
    description:
      "Where a film can be watched in the UK right now: streaming in a subscription, free, free with ads, to rent, to buy. " +
      "Flags which services Tim subscribes to, and whether he owns the film (then it's on his shelf or in the loft). Needs the film's TMDB id (from the database or search_tmdb).",
    input_schema: {
      type: "object",
      properties: { tmdb_id: { type: "integer" } },
      required: ["tmdb_id"],
    },
  },
  {
    name: "search_tmdb",
    description: "Find films on TMDB by title (for films Tim doesn't have in his data, or to get a TMDB id). Returns up to 8 matches with TMDB score and votes, flagging any he owns.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, year: { type: "integer", description: "Release year, if known." } },
      required: ["title"],
    },
  },
  {
    name: "discover_on_my_services",
    description:
      "Films currently streaming (or free) on Tim's UK services, from TMDB, with which of his services each is on, TMDB score and votes. " +
      "Use for 'anything' recommendations. Films he has watched or marked seen are left out unless include_watched is true. " +
      "Films he owns are flagged (owned: shelf/loft, box, spine): suggest his own copy rather than streaming. " +
      "For underrated films use sort rating with max_votes 1000.",
    input_schema: {
      type: "object",
      properties: {
        genre: { type: "string", enum: Object.keys(TMDB_GENRES) },
        decade: { type: "integer", description: "e.g. 1980 for the 1980s" },
        max_runtime: { type: "integer", description: "Minutes" },
        sort: { type: "string", enum: ["popularity", "rating"], description: "popularity (default) or rating (well-reviewed first)" },
        service: { type: "string", description: "Only this one of his services, e.g. \"Amazon Prime Video\", \"Netflix\" (matched by name)" },
        max_votes: { type: "integer", description: "At most this many TMDB votes (e.g. 1000 for underrated)" },
        min_votes: { type: "integer", description: "At least this many TMDB votes (default 200)" },
        include_watched: { type: "boolean" },
      },
    },
  },
  // Foundry hosted on Azure supports the basic web search tool version.
  { type: "web_search_20250305", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: "GB", timezone: "Europe/London" } },
];

/** A short line for the chat while a tool runs. */
export function toolStatus(name: string): string {
  return {
    query_database: "Looking in your collection and watch log…",
    where_to_watch: "Checking where it's streaming…",
    search_tmdb: "Searching TMDB…",
    discover_on_my_services: "Looking at what's on your services…",
    web_search: "Searching the web…",
  }[name] ?? "Working…";
}

type Input = Record<string, unknown>;

const subscribedServices = async () => (await listServices()).filter((s) => s.subscribed);

/** Tim's copies of these TMDB films (not "gone"): where they are, the box and its spine. */
async function ownedCopies(ids: number[]): Promise<Map<number, { where: string; box: string; spine: string; format: string }>> {
  if (!ids.length) return new Map();
  const r = await db.execute<{ tmdb_id: number; location: string; box: string; spine: string; format: string }>(sql`
    select distinct on (i.tmdb_id) i.tmdb_id, p.location::text as location, p.title as box, array_to_string(p.spine_colours, ' / ') as spine, i.format::text as format
    from items i join products p on p.id = i.product_id
    where i.tmdb_id in ${ids} and p.location <> 'gone'
    order by i.tmdb_id, p.location = 'shelf' desc`);
  return new Map(r.rows.map((x) => [x.tmdb_id, { where: x.location, box: x.box, spine: x.spine, format: x.format }]));
}
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Runs a client tool. Always returns text for the tool_result; errors are reported to the model, not thrown. */
export async function runTool(name: string, input: Input): Promise<string> {
  try {
    switch (name) {
      case "query_database": {
        const q = str(input.sql);
        return q ? runReadOnlyQuery(q) : JSON.stringify({ error: "sql is required" });
      }
      case "where_to_watch": {
        const id = int(input.tmdb_id);
        if (!id) return JSON.stringify({ error: "tmdb_id must be an integer" });
        const w = await availabilityFor(id);
        if (!w) return JSON.stringify({ error: "Couldn't reach TMDB for streaming data." });
        const fmt = (list: { providerId: number; name: string }[]) => list.map((o) => (w.mine.has(o.providerId) ? `${o.name} (Tim's)` : o.name));
        const owned = (await ownedCopies([id])).get(id) ?? null;
        return JSON.stringify({ tmdb_id: id, owned, stream: fmt(w.stream), free: fmt(w.free), free_with_ads: fmt(w.ads), rent: fmt(w.rent), buy: fmt(w.buy), source: "JustWatch via TMDB" });
      }
      case "search_tmdb": {
        const title = str(input.title);
        if (!title) return JSON.stringify({ error: "title is required" });
        const results = (await searchMovies(title, int(input.year))).slice(0, 8);
        const owned = await ownedCopies(results.map((r) => r.tmdbId));
        return JSON.stringify(results.map((r) => ({ tmdb_id: r.tmdbId, title: r.title, year: r.year, score: r.voteAverage, votes: r.voteCount, owned: owned.get(r.tmdbId) ?? null })));
      }
      case "discover_on_my_services": {
        const subscribed = await subscribedServices();
        if (!subscribed.length) return JSON.stringify({ error: "Tim hasn't ticked any streaming services in Settings." });
        // One service by name ("Amazon" matches "Amazon Prime Video" and its free-with-ads tier).
        const wanted = str(input.service)?.toLowerCase();
        const chosen = wanted ? subscribed.filter((s) => s.name.toLowerCase().includes(wanted) || wanted.includes(s.name.toLowerCase())) : subscribed;
        if (!chosen.length) return JSON.stringify({ error: `None of Tim's services matches "${input.service}". His services: ${subscribed.map((s) => s.name).join(", ")}` });
        const providerIds = chosen.map((s) => s.providerId);
        const genre = str(input.genre)?.toLowerCase();
        const res = await discoverOnServices({
          providerIds, decade: int(input.decade), maxRuntime: int(input.max_runtime), genreId: genre ? TMDB_GENRES[genre] : undefined,
          sort: input.sort === "rating" ? "rating" : "popularity", maxVotes: int(input.max_votes), minVotes: int(input.min_votes),
        });
        const seen = input.include_watched ? new Set<number>() : new Set((await db.execute<{ tmdb_id: number }>(sql`
          select tmdb_id from watches where tmdb_id is not null
          union select tmdb_id from items where tmdb_id is not null and watched_before_logging
          union select tmdb_id from seen_films where tmdb_id is not null`)).rows.map((r) => r.tmdb_id));
        // Discover can include films only rentable from a ticked store; check each and keep those streaming on his services.
        const mine = new Set(providerIds);
        const candidates = res.results.filter((m) => !seen.has(m.tmdbId)).slice(0, 12);
        const owned = await ownedCopies(candidates.map((m) => m.tmdbId));
        const checked = await Promise.all(candidates.map(async (m) => {
          const w = await availabilityFor(m.tmdbId);
          const on = w ? [...new Set([...w.stream, ...w.free, ...w.ads].filter((o) => mine.has(o.providerId)).map((o) => o.name))] : [];
          return { tmdb_id: m.tmdbId, title: m.title, year: m.year, score: m.voteAverage, votes: m.voteCount, on_tims_services: on, owned: owned.get(m.tmdbId) ?? null };
        }));
        return JSON.stringify({ total_on_services: res.totalResults, films: checked.filter((f) => f.on_tims_services.length) });
      }
      default:
        return JSON.stringify({ error: `Unknown tool ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}
