import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import * as schema from "./schema";

// With DATABASE_URL set (production, e.g. Neon) the app talks to a real Postgres
// server. Without it, local development runs Postgres in-process via PGlite,
// stored in ./.pglite. Both speak the same SQL, so queries don't change.
export const PGLITE_DIR = process.env.PGLITE_DIR ?? "./.pglite";

/** The drizzle API both drivers share. */
export type Db = PgliteDatabase<typeof schema>;

/** Raw SQL access, for the few places that need it. */
export type SqlClient = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};

export function createDb(dataDir: string = PGLITE_DIR): {
  db: Db;
  client: SqlClient;
  kind: "postgres" | "pglite";
  migrate: (migrationsFolder: string) => Promise<void>;
} {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
    const db = drizzlePg({ client: pool, schema });
    return {
      kind: "postgres",
      db: db as unknown as Db,
      client: {
        query: async <T>(text: string, params?: unknown[]) => ({ rows: (await pool.query(text, params)).rows as T[] }),
        close: () => pool.end(),
      },
      migrate: (migrationsFolder) => migratePg(db, { migrationsFolder }),
    };
  }

  const pglite = new PGlite(dataDir, { extensions: { pg_trgm } });
  const db = drizzlePglite({ client: pglite, schema });
  return {
    kind: "pglite",
    db,
    client: {
      query: async <T>(text: string, params?: unknown[]) => ({ rows: (await pglite.query<T>(text, params)).rows }),
      close: () => pglite.close(),
    },
    migrate: (migrationsFolder) => migratePglite(db, { migrationsFolder }),
  };
}
