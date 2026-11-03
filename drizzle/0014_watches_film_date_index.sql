DROP INDEX "watches_film_key_idx";--> statement-breakpoint
CREATE INDEX "watches_film_key_watched_on_idx" ON "watches" USING btree ("film_key","watched_on");