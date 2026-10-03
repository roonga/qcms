-- The reporting views learn about repeating groups (task 075, ADR-42, Q18 ruled
-- 2026-09-29 by the Code Owner).
--
-- `reporting.responses.answers` was built with
-- `jsonb_object_agg(item ->> 'questionId', item -> 'value')`, and two locked
-- answers for one `questionId` is exactly what a repeating group produces.
-- `jsonb_object_agg` silently keeps one of them: no error, no warning, an answer
-- gone. That is the data-loss window this migration closes.
--
-- After it: every answer outside a group keeps its `questionId -> value` entry,
-- so a form with no group produces a byte-identical `answers` object; every
-- answer inside a group is carried under one key per group id, holding an
-- ordered array of `{"instance_id": ..., "<questionId>": value, ...}`; and
-- `reporting.answers_flat` gains a nullable `instance_id` appended to its column
-- list, making its grain `(session, questionId, instanceId)`.
--
-- DROP and CREATE rather than CREATE OR REPLACE, because a replacement may not
-- change a view's column list and `answers_flat` gains one. Row inclusion is
-- unchanged: submitted-only plus the `erasure_tombstones` anti-join, still in the
-- view (ADR-17, `docs/reporting-view.md`).
--
-- THIS BODY IS GENERATED. It is `reportingViewMigrationSql({ reporting:
-- "reporting" })` from `packages/db/src/reporting-views.ts`, and
-- `packages/db/src/reporting-views.test.ts` fails if the two fall out of step.
-- Under ADR-40 the view set is per environment (`reporting_<env>`) and after task
-- 068 per workspace, so the SQL is a function of its schema names rather than a
-- literal nobody can create twice.
DROP VIEW IF EXISTS "reporting"."answers_flat";
--> statement-breakpoint
DROP VIEW IF EXISTS "reporting"."responses";
--> statement-breakpoint
CREATE VIEW "reporting"."responses" AS
SELECT
	"sub"."session_id" AS "session_id",
	"s"."form_id" AS "form_id",
	"s"."form_version" AS "form_version",
	"sub"."submitted_at" AS "submitted_at",
	"s"."access_mode" AS "access_mode",
	COALESCE("agg"."answers", '{}'::jsonb) AS "answers"
FROM "submissions" "sub"
JOIN "sessions" "s" ON "s"."session_id" = "sub"."session_id"
LEFT JOIN "erasure_tombstones" "t" ON "t"."session_id" = "sub"."session_id"
LEFT JOIN LATERAL (
	-- One pass over the locked answers, split by whether the answer names an
	-- instance, then merged into one object. jsonb_object_agg is safe here
	-- BECAUSE of the split: the keys it sees are one per ungrouped question plus
	-- one per group id, and neither can repeat.
	SELECT jsonb_object_agg("merged"."key", "merged"."value") AS "answers"
	FROM (
		SELECT
			"flat"."item" ->> 'questionId' AS "key",
			"flat"."item" -> 'value' AS "value"
		FROM jsonb_array_elements("sub"."locked_answers" -> 'answers') AS "flat"("item")
		WHERE NOT ("flat"."item" ? 'instanceId')
		UNION ALL
		SELECT
			"instances"."group_id" AS "key",
			jsonb_agg("instances"."instance" ORDER BY "instances"."first_seen") AS "value"
		FROM (
			SELECT
				"roster"."group_id" AS "group_id",
				"live"."first_seen" AS "first_seen",
				jsonb_build_object('instance_id', "live"."instance_id")
					|| COALESCE("cells"."cells", '{}'::jsonb) AS "instance"
			FROM (
				-- The LIVE instance set, taken from the submission's own flow state
				-- rather than from its answers: an instance a respondent added and left
				-- blank is still live (ADR-42), so deriving the list from `answers`
				-- would drop it and shift every later instance's ordinal by one.
				-- `visible` carries one entry per (visible question, live instance) in
				-- document order with instances in roster order, which is the order the
				-- locked set froze.
				SELECT
					"v"."item" ->> 'instanceId' AS "instance_id",
					min("v"."ordinality") AS "first_seen"
				FROM jsonb_array_elements("sub"."locked_answers" -> 'flowState' -> 'visible')
					WITH ORDINALITY AS "v"("item", "ordinality")
				WHERE "v"."item" ? 'instanceId'
				GROUP BY "v"."item" ->> 'instanceId'
			) "live"
			JOIN (
				SELECT DISTINCT "agi"."instance_id" AS "instance_id", "agi"."group_id" AS "group_id"
				FROM "answer_group_instances" "agi"
				WHERE "agi"."session_id" = "sub"."session_id"
			) "roster" ON "roster"."instance_id" = "live"."instance_id"
			LEFT JOIN LATERAL (
				-- That instance's answered cells. LEFT, because a live instance with no
				-- answer at all contributes an object carrying only its id, which is
				-- what makes jsonb_array_length(answers -> '<groupId>') the live count.
				SELECT jsonb_object_agg("elem"."item" ->> 'questionId', "elem"."item" -> 'value') AS "cells"
				FROM jsonb_array_elements("sub"."locked_answers" -> 'answers') AS "elem"("item")
				WHERE "elem"."item" ->> 'instanceId' = "live"."instance_id"
			) "cells" ON true
		) "instances"
		GROUP BY "instances"."group_id"
	) "merged"
) "agg" ON true
WHERE "s"."status" = 'submitted'
	AND "t"."session_id" IS NULL;
--> statement-breakpoint
CREATE VIEW "reporting"."answers_flat" AS
SELECT
	"r"."session_id" AS "session_id",
	"r"."form_id" AS "form_id",
	"r"."form_version" AS "form_version",
	"r"."submitted_at" AS "submitted_at",
	"unpivoted"."question_id" AS "question_id",
	"unpivoted"."value" AS "value",
	"unpivoted"."instance_id" AS "instance_id"
FROM "reporting"."responses" "r"
CROSS JOIN LATERAL (
	-- Answers outside every group: the key is the questionId and there is no
	-- instance. A multiChoice selection stays ONE row (the grain is the question,
	-- not the option), which is what the second predicate protects.
	SELECT
		"kv"."key" AS "question_id",
		NULL::text AS "instance_id",
		"kv"."value" AS "value"
	FROM jsonb_each("r"."answers") AS "kv"("key", "value")
	WHERE jsonb_typeof("kv"."value") <> 'array'
		OR jsonb_typeof("kv"."value" -> 0) IS DISTINCT FROM 'object'
	UNION ALL
	-- Answers inside a group: one row per (instance, member question), with the
	-- group's own array key contributing no row of its own.
	SELECT
		"cell"."key" AS "question_id",
		"instance"."item" ->> 'instance_id' AS "instance_id",
		"cell"."value" AS "value"
	FROM jsonb_each("r"."answers") AS "group_key"("key", "value")
	CROSS JOIN jsonb_array_elements("group_key"."value") AS "instance"("item")
	CROSS JOIN jsonb_each("instance"."item") AS "cell"("key", "value")
	WHERE jsonb_typeof("group_key"."value") = 'array'
		AND jsonb_typeof("group_key"."value" -> 0) = 'object'
		AND "cell"."key" <> 'instance_id'
) "unpivoted";
