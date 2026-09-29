import "server-only";
import { createDb } from "./client";

// PGlite holds an exclusive lock on its data directory, so the app keeps one
// instance per process (and survives dev-server hot reloads via globalThis).
const globalForDb = globalThis as unknown as {
  spinefindDb?: ReturnType<typeof createDb>;
  spinefindDbCloseHooked?: boolean;
};

export const { db, client } = (globalForDb.spinefindDb ??= createDb());

// PGlite can corrupt its data directory if the process dies mid-write, so
// close it cleanly when the server is stopped (Ctrl+C or a normal shutdown).
// A hard kill (Task Manager, `taskkill /f`) still can't be caught.
if (!globalForDb.spinefindDbCloseHooked) {
  globalForDb.spinefindDbCloseHooked = true;
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.once(signal, () => {
      client
        .close()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
  }
}
