ALTER TABLE "twoFactor" ADD COLUMN "verified" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD COLUMN "failedVerificationCount" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD COLUMN "lockedUntil" timestamp;