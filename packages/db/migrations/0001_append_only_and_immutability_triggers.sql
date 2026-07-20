-- Database-level backstops for the append-only ledger (I5) and snapshot
-- immutability (R1, I1). These are cross-version predicates ("this value may
-- not change") that compare OLD and NEW, which a CHECK constraint cannot
-- express — CHECK only validates a NEW row against a static predicate. Hence
-- BEFORE UPDATE triggers. See packages/db/README.md for the full rationale.

-- answers: append-only. Any UPDATE is rejected. DELETE is deliberately NOT
-- guarded here — the sole DELETE door is whole-session erasure (ADR-17, 016).
CREATE FUNCTION answers_reject_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'answers are append-only (I5): UPDATE is rejected'
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER answers_reject_update
	BEFORE UPDATE ON answers
	FOR EACH ROW EXECUTE FUNCTION answers_reject_update();
--> statement-breakpoint

-- question_versions: once published, the definition is frozen (I1). Status may
-- still transition (e.g. published -> deprecated) and published_at may be set,
-- but the definition JSONB cannot change after publish.
CREATE FUNCTION question_versions_freeze_published() RETURNS trigger AS $$
BEGIN
	IF OLD.status = 'published' AND NEW.definition IS DISTINCT FROM OLD.definition THEN
		RAISE EXCEPTION 'published question_versions.definition is immutable (I1): UPDATE is rejected'
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER question_versions_freeze_published
	BEFORE UPDATE ON question_versions
	FOR EACH ROW EXECUTE FUNCTION question_versions_freeze_published();
--> statement-breakpoint

-- form_versions: immutable published snapshots (R1, I1). No UPDATE path exists;
-- every UPDATE is rejected.
CREATE FUNCTION form_versions_reject_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'form_versions are immutable (R1, I1): UPDATE is rejected'
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER form_versions_reject_update
	BEFORE UPDATE ON form_versions
	FOR EACH ROW EXECUTE FUNCTION form_versions_reject_update();
