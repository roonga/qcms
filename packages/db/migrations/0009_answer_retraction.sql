-- Answer retraction as a tombstone append (ADR-33, issue #95). A respondent who
-- clears an answered question appends a retraction row instead of the ledger
-- silently keeping the stale answer: `retracted = true` with `value = NULL`.
-- This is an ordinary INSERT, so R3 / ADR-17 append-only semantics are untouched
-- (no row is mutated or deleted, and the UPDATE-reject and DELETE-guard triggers
-- from migrations 0001/0004 continue to cover retraction rows exactly as they
-- cover answers). `latestAnswers` resolves a question whose newest row is a
-- retraction to unanswered; `answerLedger` keeps showing it, so the audit trail
-- records THAT a retraction happened rather than erasing it.
--
-- `value` becomes nullable because a retraction carries no answer. A sentinel
-- inside the `value` JSON was rejected: it could collide with author-supplied
-- content and would force every reader to sniff for it. The CHECK below is what
-- keeps the two row shapes mutually exclusive, so no reader has to trust the
-- writer: an answer always carries a value, a retraction never does.
ALTER TABLE "answers" ALTER COLUMN "value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "retracted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_retraction_value" CHECK (
	("retracted" AND "value" IS NULL) OR (NOT "retracted" AND "value" IS NOT NULL)
);
