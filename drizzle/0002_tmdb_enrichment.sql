CREATE TYPE "public"."credit_role" AS ENUM('cast', 'crew');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('auto', 'review', 'confirmed', 'rejected', 'unmatched');--> statement-breakpoint
CREATE TABLE "film_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"tmdb_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"role" "credit_role" NOT NULL,
	"job" text NOT NULL,
	"character" text,
	"billing" integer
);
--> statement-breakpoint
CREATE TABLE "film_titles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tmdb_id" integer NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"country" text
);
--> statement-breakpoint
CREATE TABLE "people" (
	"tmdb_person_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"profile_path" text
);
--> statement-breakpoint
CREATE TABLE "tmdb_matches" (
	"match_key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"release_year" integer,
	"status" "match_status" NOT NULL,
	"tmdb_id" integer,
	"method" text,
	"candidates" jsonb,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "uk_release_date" date;--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "overview" text;--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "keywords" text[];--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "countries" text[];--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "original_language" text;--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "uk_certificate" text;--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "collection_id" integer;--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "collection_name" text;--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "vote_average" real;--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "vote_count" integer;--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "film_credits" ADD CONSTRAINT "film_credits_tmdb_id_films_tmdb_id_fk" FOREIGN KEY ("tmdb_id") REFERENCES "public"."films"("tmdb_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_credits" ADD CONSTRAINT "film_credits_person_id_people_tmdb_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("tmdb_person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_titles" ADD CONSTRAINT "film_titles_tmdb_id_films_tmdb_id_fk" FOREIGN KEY ("tmdb_id") REFERENCES "public"."films"("tmdb_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "film_credits_unique_idx" ON "film_credits" USING btree ("tmdb_id","person_id","role","job");--> statement-breakpoint
CREATE INDEX "film_credits_person_idx" ON "film_credits" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "film_titles_unique_idx" ON "film_titles" USING btree ("tmdb_id","title","country");--> statement-breakpoint
CREATE INDEX "film_titles_tmdb_idx" ON "film_titles" USING btree ("tmdb_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "film_titles_title_trgm_idx" ON "film_titles" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tmdb_matches_status_idx" ON "tmdb_matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_tmdb_idx" ON "items" USING btree ("tmdb_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watches_tmdb_idx" ON "watches" USING btree ("tmdb_id");
