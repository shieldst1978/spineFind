CREATE TABLE "film_availability" (
	"tmdb_id" integer PRIMARY KEY NOT NULL,
	"offers" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streaming_services" (
	"provider_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"logo_path" text,
	"priority" integer DEFAULT 999 NOT NULL,
	"subscribed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
