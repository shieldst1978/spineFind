import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { asc, desc, eq, sql } from "drizzle-orm";
import pg from "pg";
import { db } from ".";
import { assistantConversations, assistantMessages } from "./schema";

// ---- conversations

export type StoredMessage = { role: "user" | "assistant"; content: Anthropic.MessageParam["content"] };

export async function createConversation(title: string): Promise<string> {
  const [c] = await db.insert(assistantConversations).values({ title: title.slice(0, 80) }).returning({ id: assistantConversations.id });
  return c.id;
}

export async function listConversations(limit = 30) {
  return db.select({ id: assistantConversations.id, title: assistantConversations.title, updatedAt: assistantConversations.updatedAt })
    .from(assistantConversations).orderBy(desc(assistantConversations.updatedAt)).limit(limit);
}

export async function getConversation(id: string) {
  const [c] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, id));
  if (!c) return null;
  const messages = await db.select().from(assistantMessages).where(eq(assistantMessages.conversationId, id)).orderBy(asc(assistantMessages.createdAt), asc(assistantMessages.id));
  return { ...c, messages };
}

/** Appends one message exactly as sent to or received from Claude. */
export async function saveMessage(conversationId: string, m: StoredMessage, usage?: unknown, costUsd?: number) {
  await db.insert(assistantMessages).values({ conversationId, role: m.role, content: m.content as object, usage: (usage ?? null) as object | null, costUsd: costUsd ?? null });
  await db.update(assistantConversations).set({ updatedAt: new Date() }).where(eq(assistantConversations.id, conversationId));
}

export async function deleteConversation(id: string) {
  await db.delete(assistantConversations).where(eq(assistantConversations.id, id));
}

/** What the assistant has cost today (UK time), in US dollars as Azure bills Claude. */
export async function spentTodayUsd(): Promise<number> {
  const r = await db.execute<{ usd: number | null }>(sql`
    select sum(cost_usd)::float8 as usd from assistant_messages
    where created_at >= (date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London')`);
  return r.rows[0]?.usd ?? 0;
}

// ---- read-only SQL for the query_database tool

let pool: pg.Pool | null = null;
function readOnlyPool() {
  const url = process.env.ASSISTANT_DATABASE_URL;
  if (!url) throw new Error("ASSISTANT_DATABASE_URL is not set");
  // Dates as plain YYYY-MM-DD strings, not midnight timestamps.
  pool ??= new pg.Pool({ connectionString: url, max: 2, types: { getTypeParser: (oid, format) => (oid === 1082 ? (v: string) => v : pg.types.getTypeParser(oid, format)) } });
  return pool;
}

const MAX_ROWS = 150;
const MAX_CHARS = 24_000;

/**
 * Runs one SELECT as the read-only spinefind_assistant login (it can't write,
 * and stops after 8 seconds). Returns compact JSON for the model.
 */
export async function runReadOnlyQuery(query: string): Promise<string> {
  const text = query.trim().replace(/;\s*$/, "");
  if (!/^(select|with|values|table|explain)\b/i.test(text.replace(/^(\s*--[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*/g, "").trim())) {
    return JSON.stringify({ error: "Only a single SELECT (or WITH … SELECT) query is allowed." });
  }
  try {
    // Parameters (none) force the extended protocol, which runs exactly one statement.
    const r = await readOnlyPool().query({ text, values: [] });
    const rows = r.rows.slice(0, MAX_ROWS);
    let json = JSON.stringify({ rowCount: r.rowCount, columns: r.fields.map((f) => f.name), rows: rows.map((row) => r.fields.map((f) => row[f.name])) });
    if (r.rows.length > MAX_ROWS) json = json.slice(0, -1) + `,"note":"only the first ${MAX_ROWS} of ${r.rows.length} rows are shown; aggregate or add a LIMIT"}`;
    return json.length > MAX_CHARS ? json.slice(0, MAX_CHARS) + `… (truncated; select fewer columns or rows)` : json;
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}
