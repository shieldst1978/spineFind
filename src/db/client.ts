import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";

// Local development runs Postgres in-process via PGlite, stored in ./.pglite.
// Production will swap this for Azure Database for PostgreSQL.
export const PGLITE_DIR = process.env.PGLITE_DIR ?? "./.pglite";

export function createDb(dataDir: string = PGLITE_DIR) {
  const client = new PGlite(dataDir, { extensions: { pg_trgm } });
  return { client, db: drizzle({ client, schema }) };
}

export type Db = ReturnType<typeof createDb>["db"];
