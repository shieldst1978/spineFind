import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from ".";
import { filmAvailability, streamingServices } from "./schema";
import { getUkAvailability, listUkProviders, tmdbEnabled, type Availability } from "@/lib/tmdb";

const SERVICES_MAX_AGE_DAYS = 30;
const AVAILABILITY_MAX_AGE_HOURS = 24;

export type StreamingService = typeof streamingServices.$inferSelect;

/**
 * The UK services list, refreshed from TMDB once a month (new services appear,
 * names change). Your ticks are kept across refreshes.
 */
export async function listServices(): Promise<StreamingService[]> {
  const [newest] = await db.select({ at: streamingServices.updatedAt }).from(streamingServices).orderBy(desc(streamingServices.updatedAt)).limit(1);
  const stale = !newest || Date.now() - newest.at.getTime() > SERVICES_MAX_AGE_DAYS * 864e5;
  if (stale && tmdbEnabled()) {
    try {
      const providers = await listUkProviders();
      if (providers.length) {
        await db.insert(streamingServices)
          .values(providers.map((p) => ({ providerId: p.providerId, name: p.name, logoPath: p.logoPath, priority: p.priority, updatedAt: new Date() })))
          .onConflictDoUpdate({
            target: streamingServices.providerId,
            set: { name: sql`excluded.name`, logoPath: sql`excluded.logo_path`, priority: sql`excluded.priority`, updatedAt: sql`excluded.updated_at` },
          });
      }
    } catch (e) {
      console.error("TMDB provider list failed", e);
    }
  }
  return db.select().from(streamingServices).orderBy(desc(streamingServices.subscribed), asc(streamingServices.priority), asc(streamingServices.name));
}

/** Replaces the set of services you subscribe to. */
export async function setSubscribed(providerIds: number[]) {
  await db.transaction(async (tx) => {
    await tx.update(streamingServices).set({ subscribed: false }).where(eq(streamingServices.subscribed, true));
    if (providerIds.length) {
      await tx.update(streamingServices).set({ subscribed: true }).where(sql`${streamingServices.providerId} in ${providerIds}`);
    }
  });
}

export type FilmAvailability = Availability & { mine: Set<number> };

/** Where a film can be watched in the UK, with the services you have marked. Null if TMDB can't be reached. */
export async function availabilityFor(tmdbId: number): Promise<FilmAvailability | null> {
  const [cached] = await db.select().from(filmAvailability).where(eq(filmAvailability.tmdbId, tmdbId));
  let offers = cached && Date.now() - cached.fetchedAt.getTime() < AVAILABILITY_MAX_AGE_HOURS * 36e5 ? (cached.offers as Availability) : null;
  if (!offers && tmdbEnabled()) {
    try {
      offers = await getUkAvailability(tmdbId);
      await db.insert(filmAvailability).values({ tmdbId, offers, fetchedAt: new Date() })
        .onConflictDoUpdate({ target: filmAvailability.tmdbId, set: { offers, fetchedAt: new Date() } });
    } catch (e) {
      console.error("TMDB availability failed", tmdbId, e);
      offers = cached ? (cached.offers as Availability) : null;
    }
  }
  if (!offers) return null;
  const mine = new Set((await db.select({ id: streamingServices.providerId }).from(streamingServices).where(eq(streamingServices.subscribed, true))).map((s) => s.id));
  return { ...offers, mine };
}
