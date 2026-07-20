-- Scoped DELETE door for the append-only ledger (ADR-17, I5 amendment). Until
-- now DELETE on `answers` was unguarded — migration 0001 rejects UPDATE only and
-- deliberately left DELETE open for erasure (016). This closes that gap: DELETE
-- is rejected unless the transaction-local guard `qcms.allow_answer_delete` is
-- set to 'on'. The two sanctioned whole-session delete doors — `eraseSession`
-- (016) and `purgeExpired` (015) — set it via set_config(..., is_local => true)
-- inside their transaction; every other (ad-hoc) DELETE is rejected. SET LOCAL
-- reverts at transaction end, so the door is never left open.
--
-- current_setting(..., missing_ok => true) returns NULL when the GUC was never
-- set, so `IS DISTINCT FROM 'on'` rejects the un-flagged case (NULL or any other
-- value) and permits only the explicit 'on'.
CREATE FUNCTION answers_reject_delete() RETURNS trigger AS $$
BEGIN
	IF current_setting('qcms.allow_answer_delete', true) IS DISTINCT FROM 'on' THEN
		RAISE EXCEPTION 'answers DELETE is only permitted via the sanctioned erasure/retention path (ADR-17)'
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER answers_reject_delete
	BEFORE DELETE ON answers
	FOR EACH ROW EXECUTE FUNCTION answers_reject_delete();
