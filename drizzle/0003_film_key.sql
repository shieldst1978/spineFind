DROP VIEW "public"."item_watch_status";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "film_key" text GENERATED ALWAYS AS (coalesce('tmdb:' || tmdb_id::text, match_key)) STORED;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "film_key" text GENERATED ALWAYS AS (coalesce('tmdb:' || tmdb_id::text, match_key)) STORED;--> statement-breakpoint
CREATE INDEX "items_film_key_idx" ON "items" USING btree ("film_key");--> statement-breakpoint
CREATE INDEX "watches_film_key_idx" ON "watches" USING btree ("film_key");--> statement-breakpoint
CREATE VIEW "public"."item_watch_status" AS (
  select
    i.id as item_id,
    case
      when i.item_type <> 'film' then null
      else i.watched_before_logging or count(w.id) > 0
    end as watched,
    count(w.id)::int as disc_watch_count,
    max(w.watched_on) as last_disc_watch
  from items i
  left join watches w
    on w.film_key = i.film_key
    and w.format_id in (select id from viewing_formats where kind = 'disc')
  group by i.id
);