// Container entry point: bring the database schema up to date, then start Next.
// Migrations are idempotent, so running them on every start is safe.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set; refusing to start without a database.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  console.log("Database schema is up to date.");
} finally {
  await pool.end();
}

await import("./server.js");
