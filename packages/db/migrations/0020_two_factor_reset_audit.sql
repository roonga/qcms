CREATE TABLE "two_factor_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"database_role" text NOT NULL,
	"cleared_factors" integer NOT NULL,
	"was_enrolled" boolean NOT NULL
);
