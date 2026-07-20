-- Per-form abuse-control settings (task 026). Both columns are additive and
-- backfill-safe, living on the mutable `forms` identity row (operational
-- domain config, like `status` — NOT part of the immutable published
-- definition, and NOT a deployment flag; ADR-24).
--
--   challenge_required : when true, start-session (018) demands a passing
--                        challenge for this form (verified by the configured
--                        ChallengeVerifier). Defaults false; with challenge
--                        provider `none` the check no-ops regardless.
--   min_submit_ms      : per-form override of the min-time-to-complete floor
--                        (config `QCMS_ANTIABUSE_MIN_SUBMIT_MS` is the default).
--                        NULL = use the config default. A submit faster than
--                        the effective floor is silently flagged `MIN_TIME`.
ALTER TABLE "forms" ADD COLUMN "challenge_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "min_submit_ms" integer;
