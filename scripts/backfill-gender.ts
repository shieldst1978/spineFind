/**
 * Fills in people.gender from TMDB for everyone credited on stored films (one credits request per film).
 * New films get it automatically when stored; this is for the ones stored before gender was kept.
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/backfill-gender.ts --cloud [--production]
 *
 * Only fills blanks, so it's safe to re-run.
 */
import { createDb } from "../src/db/client";
import { getCreditGenders } from "../src/lib/tmdb";

const flags = new Set(process.argv.slice(2));

async function main() {
  if (!process.env.TMDB_READ_TOKEN) throw new Error("TMDB_READ_TOKEN is not set");
  const { client, kind, migrate } = createDb();
  if (kind !== "postgres" || !flags.has("--cloud")) throw new Error("Run against a hosted database with DATABASE_URL set and --cloud.");
  const host = new URL(process.env.DATABASE_URL!).hostname;
  if (process.env.NEON_PROD_DATABASE_URL && new URL(process.env.NEON_PROD_DATABASE_URL).hostname === host && !flags.has("--production")) {
    throw new Error(`DATABASE_URL is the production database (${host}). Add --production to really run against it.`);
  }
  console.log(`Backfilling genders on ${host}`);
  await migrate("./drizzle");

  // Films with credited people whose gender isn't known yet.
  const films = (await client.query<{ tmdb_id: number }>(`
    select distinct c.tmdb_id from film_credits c join people p on p.tmdb_person_id = c.person_id where p.gender is null`)).rows.map((r) => r.tmdb_id);
  console.log(`${films.length} films to check`);
  let next = 0, done = 0, failed = 0, updated = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < films.length) {
      const id = films[next++];
      try {
        const g = await getCreditGenders(id);
        if (g.length) {
          const r = await client.query<{ n: number }>(
            `with u as (update people p set gender = x.gender from unnest($1::int[], $2::int[]) as x(id, gender)
               where p.tmdb_person_id = x.id and p.gender is null returning 1) select count(*)::int as n from u`,
            [g.map((x) => x.personId), g.map((x) => x.gender)],
          );
          updated += r.rows[0].n;
        }
        if (++done % 250 === 0) console.log(`  ${done}/${films.length}, ${updated} people updated`);
      } catch (e) {
        failed++;
        console.error(`  ! TMDB #${id}: ${(e as Error).message}`);
      }
    }
  }));
  const summary = (await client.query<{ gender: number | null; n: number }>(`select gender, count(*)::int as n from people group by 1 order by 1`)).rows;
  console.log(`done: ${done} films, ${failed} failed, ${updated} people updated; people by gender:`, summary.map((s) => `${s.gender ?? "unknown"}=${s.n}`).join(", "));
  await client.close();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
