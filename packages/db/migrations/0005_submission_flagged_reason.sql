-- Anti-abuse flag on submissions (task 020). Additive, nullable column: NULL is
-- a clean submission, a non-null reason (e.g. 'honeypot', 'too_fast') marks a
-- submission that was accepted with the usual success-shaped response but is
-- withheld from webhook delivery pending review — the slice does not enqueue the
-- `response.submitted` outbox event for a flagged row (released later by the
-- admin unflag, 023). Backfill-safe: existing rows default to NULL (clean).
ALTER TABLE "submissions" ADD COLUMN "flagged_reason" text;