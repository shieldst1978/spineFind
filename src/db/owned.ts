import { sql } from "drizzle-orm";

/** Where an owned copy (products alias `p`) is most use, best first: on the shelf, then Plex, then the loft. */
export const OWNED_ORDER = sql`array_position(array['shelf', 'plex', 'loft'], p.location::text)`;
