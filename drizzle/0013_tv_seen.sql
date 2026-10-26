CREATE TABLE "tv_seen" (
	"tmdb_tv_id" integer NOT NULL,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tv_seen_tmdb_tv_id_season_number_episode_number_pk" PRIMARY KEY("tmdb_tv_id","season_number","episode_number")
);
--> statement-breakpoint
ALTER TABLE "tv_seen" ADD CONSTRAINT "tv_seen_tmdb_tv_id_tv_shows_tmdb_tv_id_fk" FOREIGN KEY ("tmdb_tv_id") REFERENCES "public"."tv_shows"("tmdb_tv_id") ON DELETE cascade ON UPDATE no action;