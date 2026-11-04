CREATE TABLE "watchlist_removed" (
	"film_key" text PRIMARY KEY NOT NULL,
	"tmdb_id" integer NOT NULL,
	"imdb_id" text,
	"title" text NOT NULL,
	"release_year" integer,
	"added_on" date,
	"source" text NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL
);
