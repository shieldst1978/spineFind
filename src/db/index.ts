import "server-only";
import { createDb } from "./client";

// PGlite holds an exclusive lock on its data directory, so the app keeps one
// instance per process (and survives dev-server hot reloads via globalThis).
const globalForDb = globalThis as unknown as { spinefindDb?: ReturnType<typeof createDb> };

export const { db, client } = (globalForDb.spinefindDb ??= createDb());
