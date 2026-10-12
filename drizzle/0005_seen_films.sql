CREATE TABLE "seen_films" (
	"tmdb_id" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"release_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
