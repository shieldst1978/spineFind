import "server-only";
import { createDb, type Db, type SqlClient } from "./client";

// Opened on first use, not at import time: `next build` imports server code, and
// must never open (and so lock, or on the build machine create) a database.
// One instance per process, surviving dev-server hot reloads via globalThis;
// PGlite holds an exclusive lock on its data directory.
const globalForDb = globalThis as unknown as { spinefindDb?: ReturnType<typeof createDb> };

function instance() {
  if (!globalForDb.spinefindDb) {
    globalForDb.spinefindDb = createDb();
    closeOnShutdown(globalForDb.spinefindDb.client);
  }
  return globalForDb.spinefindDb;
}

export const db: Db = new Proxy({} as Db, {
  get(_, prop) {
    const real = instance().db;
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export const client: SqlClient = {
  query: (text, params) => instance().client.query(text, params),
  close: () => instance().client.close(),
};

// PGlite can corrupt its data directory if the process dies mid-write, so
// close it cleanly when the server is stopped (Ctrl+C or a normal shutdown).
// A hard kill (Task Manager, `taskkill /f`) still can't be caught.
function closeOnShutdown(c: SqlClient) {
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.once(signal, () => {
      c.close()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
  }
}
