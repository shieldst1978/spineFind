CREATE TABLE "watchlist" (
	"film_key" text PRIMARY KEY NOT NULL,
	"tmdb_id" integer NOT NULL,
	"imdb_id" text,
	"title" text NOT NULL,
	"release_year" integer,
	"added_on" date,
	"source" text DEFAULT 'imdb' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "watchlist_tmdb_idx" ON "watchlist" USING btree ("tmdb_id");