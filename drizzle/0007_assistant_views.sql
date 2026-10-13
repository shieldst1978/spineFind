-- Views for the chat assistant: one row per film you have anything to do with, and one per watch.
-- Films are identified by film_key (tmdb:<id> once linked, else normalised title|year).

CREATE VIEW "assistant_films" AS
WITH keys AS (
  SELECT film_key FROM items WHERE item_type = 'film'
  UNION SELECT film_key FROM watches
  UNION SELECT 'tmdb:' || tmdb_id FROM seen_films
),
copies AS (
  SELECT i.film_key,
    (array_agg(i.title ORDER BY p.location = 'shelf' DESC, i.created_at))[1] AS title,
    (array_agg(i.release_year ORDER BY p.location = 'shelf' DESC, i.created_at))[1] AS release_year,
    max(i.tmdb_id) AS tmdb_id,
    (array_agg(p.location::text ORDER BY p.location = 'shelf' DESC))[1] AS owned_where,
    array_agg(DISTINCT i.format::text) AS owned_formats,
    (array_agg(p.title ORDER BY p.location = 'shelf' DESC))[1] AS box_title,
    (array_agg(array_to_string(p.spine_colours, ' / ') ORDER BY p.location = 'shelf' DESC))[1] AS spine_colours,
    bool_or(i.watched_before_logging) AS seen_before_logging
  FROM items i JOIN products p ON p.id = i.product_id
  WHERE i.item_type = 'film' AND p.location <> 'gone'
  GROUP BY i.film_key
),
logged AS (
  SELECT w.film_key,
    (array_agg(w.title ORDER BY w.watched_on DESC))[1] AS title,
    max(w.release_year) AS release_year,
    max(w.tmdb_id) AS tmdb_id,
    count(*)::int AS times_watched,
    count(*) FILTER (WHERE f.kind = 'disc')::int AS disc_watches,
    min(w.watched_on) AS first_watched,
    max(w.watched_on) AS last_watched
  FROM watches w JOIN viewing_formats f ON f.id = w.format_id
  GROUP BY w.film_key
)
SELECT k.film_key,
  coalesce(c.title, l.title, s.title) AS title,
  coalesce(c.release_year, l.release_year, s.release_year) AS release_year,
  coalesce(c.tmdb_id, l.tmdb_id, s.tmdb_id) AS tmdb_id,
  c.film_key IS NOT NULL AS owned,
  c.owned_where,
  c.owned_formats,
  c.box_title,
  c.spine_colours,
  coalesce(l.times_watched, 0) AS times_watched,
  coalesce(l.disc_watches, 0) AS disc_watches,
  l.first_watched,
  l.last_watched,
  (coalesce(l.times_watched, 0) > 0 OR coalesce(c.seen_before_logging, false) OR s.tmdb_id IS NOT NULL) AS watched,
  (coalesce(c.seen_before_logging, false) OR s.tmdb_id IS NOT NULL) AS seen_before_no_date,
  fm.genres,
  fm.runtime_minutes,
  fm.uk_certificate,
  fm.uk_release_date,
  fm.directors,
  (SELECT array_agg(pe.name ORDER BY cr.billing) FROM film_credits cr JOIN people pe ON pe.tmdb_person_id = cr.person_id
    WHERE cr.tmdb_id = fm.tmdb_id AND cr.role = 'cast') AS top_cast,
  fm.keywords,
  fm.original_language,
  fm.countries,
  fm.collection_name,
  fm.vote_average,
  fm.vote_count,
  fm.overview
FROM keys k
LEFT JOIN copies c ON c.film_key = k.film_key
LEFT JOIN logged l ON l.film_key = k.film_key
LEFT JOIN seen_films s ON 'tmdb:' || s.tmdb_id = k.film_key
LEFT JOIN films fm ON fm.tmdb_id = coalesce(c.tmdb_id, l.tmdb_id, s.tmdb_id);
--> statement-breakpoint

CREATE VIEW "assistant_watches" AS
SELECT w.id,
  w.film_key,
  w.title,
  w.release_year,
  w.watched_on,
  f.name AS format,
  f.kind::text AS format_kind,
  w.format_from_memory,
  row_number() OVER (PARTITION BY w.film_key ORDER BY w.watched_on, w.created_at)::int AS nth_watch,
  w.tmdb_id
FROM watches w JOIN viewing_formats f ON f.id = w.format_id;
