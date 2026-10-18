-- assistant_watches gains logged_at: the exact time a watch was logged in the app (usually just after watching).
-- Watches imported from the spreadsheets and aNote only have a date, so it's null for them.
DROP VIEW "assistant_watches";--> statement-breakpoint
CREATE VIEW "assistant_watches" AS
SELECT w.id,
  w.film_key,
  w.title,
  w.release_year,
  w.watched_on,
  CASE WHEN w.legacy_row IS NULL THEN w.created_at END AS logged_at,
  f.name AS format,
  f.kind::text AS format_kind,
  w.format_from_memory,
  row_number() OVER (PARTITION BY w.film_key ORDER BY w.watched_on, w.created_at)::int AS nth_watch,
  w.tmdb_id
FROM watches w JOIN viewing_formats f ON f.id = w.format_id;
