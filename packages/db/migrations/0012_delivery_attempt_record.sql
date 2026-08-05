ALTER TABLE "webhook_deliveries" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_status" integer;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_request_headers" jsonb;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_response_snippet" text;