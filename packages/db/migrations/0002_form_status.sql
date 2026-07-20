CREATE TYPE "public"."form_status" AS ENUM('open', 'closed');--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "status" "form_status" DEFAULT 'open' NOT NULL;