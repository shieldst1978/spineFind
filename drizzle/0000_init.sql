CREATE TYPE "public"."flag_kind" AS ENUM('format_mismatch', 'title_near_miss', 'missing_year', 'tmdb_unmatched', 'new_format');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."format_kind" AS ENUM('disc', 'cinema', 'streaming', 'tv', 'download', 'other');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('film', 'tv_season', 'episode');--> statement-breakpoint
CREATE TYPE "public"."location" AS ENUM('shelf', 'loft', 'gone');--> statement-breakpoint
CREATE TYPE "public"."media_format" AS ENUM('4K UltraHD', 'Blu Ray', 'DVD', 'HD DVD');--> statement-breakpoint
CREATE TABLE "films" (
	"tmdb_id" integer PRIMARY KEY NOT NULL,
	"imdb_id" text,
	"title" text NOT NULL,
	"original_title" text,
	"release_date" date,
	"runtime_minutes" integer,
	"directors" text[],
	"genres" text[],
	"poster_path" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"legacy_number" integer,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"release_year" integer,
	"item_type" "item_type" DEFAULT 'film' NOT NULL,
	"format" "media_format" NOT NULL,
	"watched_before_logging" boolean DEFAULT false NOT NULL,
	"match_key" text NOT NULL,
	"tmdb_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"spine_colours" text[] NOT NULL,
	"location" "location" DEFAULT 'shelf' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "flag_kind" NOT NULL,
	"item_id" uuid,
	"watch_id" uuid,
	"detail" text NOT NULL,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "viewing_formats" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "format_kind" NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "viewing_formats_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_row" integer,
	"title" text NOT NULL,
	"release_year" integer,
	"watched_on" date NOT NULL,
	"format_id" integer NOT NULL,
	"format_from_memory" boolean DEFAULT false NOT NULL,
	"match_key" text NOT NULL,
	"tmdb_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_watch_id_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_format_id_viewing_formats_id_fk" FOREIGN KEY ("format_id") REFERENCES "public"."viewing_formats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_product_idx" ON "items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "items_match_key_idx" ON "items" USING btree ("match_key");--> statement-breakpoint
CREATE UNIQUE INDEX "items_legacy_number_idx" ON "items" USING btree ("legacy_number");--> statement-breakpoint
CREATE INDEX "products_title_idx" ON "products" USING btree ("title");--> statement-breakpoint
CREATE INDEX "watches_match_key_idx" ON "watches" USING btree ("match_key");--> statement-breakpoint
CREATE INDEX "watches_watched_on_idx" ON "watches" USING btree ("watched_on");--> statement-breakpoint
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
    on w.match_key = i.match_key
    and w.format_id in (select id from viewing_formats where kind = 'disc')
  group by i.id
);