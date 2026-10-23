CREATE TABLE "tv_episodes" (
	"tmdb_tv_id" integer NOT NULL,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"name" text,
	"air_date" date,
	"runtime" integer,
	"tmdb_episode_id" integer,
	CONSTRAINT "tv_episodes_tmdb_tv_id_season_number_episode_number_pk" PRIMARY KEY("tmdb_tv_id","season_number","episode_number")
);
--> statement-breakpoint
CREATE TABLE "tv_seasons" (
	"tmdb_tv_id" integer NOT NULL,
	"season_number" integer NOT NULL,
	"name" text,
	"air_date" date,
	"episode_count" integer,
	"poster_path" text,
	"episodes_fetched_at" timestamp with time zone,
	CONSTRAINT "tv_seasons_tmdb_tv_id_season_number_pk" PRIMARY KEY("tmdb_tv_id","season_number")
);
--> statement-breakpoint
CREATE TABLE "tv_shows" (
	"tmdb_tv_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"original_name" text,
	"first_air_date" date,
	"last_air_date" date,
	"status" text,
	"number_of_seasons" integer,
	"number_of_episodes" integer,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"networks" text[] DEFAULT '{}'::text[] NOT NULL,
	"creators" text[] DEFAULT '{}'::text[] NOT NULL,
	"poster_path" text,
	"overview" text,
	"vote_average" real,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tv_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tmdb_tv_id" integer NOT NULL,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"watched_on" date NOT NULL,
	"format_id" integer NOT NULL,
	"from_memory" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tv_episodes" ADD CONSTRAINT "tv_episodes_tmdb_tv_id_tv_shows_tmdb_tv_id_fk" FOREIGN KEY ("tmdb_tv_id") REFERENCES "public"."tv_shows"("tmdb_tv_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_seasons" ADD CONSTRAINT "tv_seasons_tmdb_tv_id_tv_shows_tmdb_tv_id_fk" FOREIGN KEY ("tmdb_tv_id") REFERENCES "public"."tv_shows"("tmdb_tv_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_watches" ADD CONSTRAINT "tv_watches_tmdb_tv_id_tv_shows_tmdb_tv_id_fk" FOREIGN KEY ("tmdb_tv_id") REFERENCES "public"."tv_shows"("tmdb_tv_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_watches" ADD CONSTRAINT "tv_watches_format_id_viewing_formats_id_fk" FOREIGN KEY ("format_id") REFERENCES "public"."viewing_formats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tv_watches_show_idx" ON "tv_watches" USING btree ("tmdb_tv_id","season_number","episode_number");--> statement-breakpoint
CREATE INDEX "tv_watches_date_idx" ON "tv_watches" USING btree ("watched_on");