-- The instance ledger (task 072, ADR-42, ADR-40's amendment, SEC-16). Two
-- additive changes: the answer ledger's key gets one more column, and the roster
-- gets a table of its own.
--
-- `answers.instance_id` is NULLABLE and is NULL for every question outside a
-- repeating group, so every existing row is already correct and nothing is
-- backfilled. The current-value rule becomes latest per `(question_id,
-- instance_id)`, so `answers_session_question_answered_at_idx` is dropped and
-- recreated with `instance_id` before `answered_at`: the leading columns of the
-- index are then exactly the `DISTINCT ON` key `latestAnswers` resolves by. The
-- index keeps its name because it is the same index serving the same read one
-- column wider. The three existing guards are untouched and cover the new column
-- by construction: `answers_reject_update` and `answers_reject_delete` are about
-- the row, not the columns, and `answers_retraction_value` constrains `retracted`
-- against `value`, so a retraction of one cell of one instance is exactly the
-- shape it already admits (ADR-33's Note - a retraction is per instance).
--
-- **The value is never touched**, and migration 0009's own rationale is the
-- precedent: a sentinel inside the `value` JSON was refused there because "it
-- could collide with author-supplied content and would force every reader to
-- sniff for it". An instance index encoded inside `value`, or inside
-- `question_id`, is the same mistake. It is a column.
--
-- `answer_group_instances` is the roster: what was minted and what was explicitly
-- removed, append-only, one row per event. It is deliberately NOT a synthetic
-- answer keyed by the group id (Q16, Code Owner, 2026-09-29), because
-- `answers.question_id` would then hold something that is not a `questionId`,
-- colliding with `prepareSubmission`'s `UNKNOWN_QUESTION` drift defence, with R6
-- and with the reporting view's contract that a row is a question.
--
-- `group_id` carries no foreign key, for the reason `answers.question_id` carries
-- none: it names a group pinned in the session's form version, not a row in a
-- mutable library. `session_id` does, and it is the eighth data-plane foreign key
-- ADR-40's amendment counts.
--
-- Four guards are declared here and they are the four that amendment attributes
-- to this table: two triggers, one CHECK and one index. The two trigger FUNCTIONS
-- are single, not one per table, which is what ADR-40 already specifies for the
-- answer ledger's pair; under that record's per-environment layout the triggers
-- multiply and the function bodies do not.
--
-- This is an ordinary APPENDED migration on the existing chain. Task 064 replaces
-- migrations 0000 onward with a per-environment baseline (Q41 on issue #995) and
-- must carry this table, its two triggers, its CHECK, its index and its foreign
-- key into that baseline; nothing here is written conditional on it.
CREATE TABLE "answer_group_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"group_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"event" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "answers_session_question_answered_at_idx";--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "instance_id" text;--> statement-breakpoint
ALTER TABLE "answer_group_instances" ADD CONSTRAINT "answer_group_instances_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_group_instances_session_group_occurred_at_idx" ON "answer_group_instances" USING btree ("session_id","group_id","occurred_at");--> statement-breakpoint
CREATE INDEX "answers_session_question_answered_at_idx" ON "answers" USING btree ("session_id","question_id","instance_id","answered_at" DESC NULLS LAST);--> statement-breakpoint

-- The event vocabulary, pinned in the database rather than trusted from the
-- writer. Hand-authored below the generated statements and deliberately absent
-- from the Drizzle mirror, exactly as `answers_retraction_value` (0009) is: this
-- package keeps its CHECKs in SQL, so `meta/*_snapshot.json` records none of them
-- and a later `drizzle-kit generate` neither re-emits nor drops one.
ALTER TABLE "answer_group_instances" ADD CONSTRAINT "answer_group_instances_event" CHECK (
	"event" IN ('added', 'removed')
);
--> statement-breakpoint

-- Append-only, the answer ledger's rule one table over (I5, R3). A roster is the
-- audit trail of what a respondent did to the shape of their own household, so a
-- removal that rewrote or dropped the `added` row would leave no record that the
-- instance had ever existed. Every event is an INSERT and nothing else.
CREATE FUNCTION answer_group_instances_reject_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'answer_group_instances are append-only (I5, ADR-42): UPDATE is rejected'
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER answer_group_instances_reject_update
	BEFORE UPDATE ON answer_group_instances
	FOR EACH ROW EXECUTE FUNCTION answer_group_instances_reject_update();
--> statement-breakpoint

-- The SAME door as the answer ledger's (`qcms.allow_answer_delete`, migration
-- 0004), honoured by the same two sanctioned whole-session delete paths,
-- `eraseSession` (ADR-17, 016) and `purgeExpired` (015). ADR-17 says there are
-- two whole-session delete paths and this migration adds no third: the roster
-- joins the existing two rather than opening a door of its own.
--
-- current_setting(..., missing_ok => true) returns NULL when the GUC was never
-- set, so `IS DISTINCT FROM 'on'` rejects the un-flagged case (NULL or any other
-- value) and permits only the explicit 'on'.
CREATE FUNCTION answer_group_instances_reject_delete() RETURNS trigger AS $$
BEGIN
	IF current_setting('qcms.allow_answer_delete', true) IS DISTINCT FROM 'on' THEN
		RAISE EXCEPTION 'answer_group_instances DELETE is only permitted via the sanctioned erasure/retention path (ADR-17)'
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER answer_group_instances_reject_delete
	BEFORE DELETE ON answer_group_instances
	FOR EACH ROW EXECUTE FUNCTION answer_group_instances_reject_delete();
