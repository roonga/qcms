ALTER TABLE "control"."user" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "control"."user" ALTER COLUMN "role" DROP NOT NULL;