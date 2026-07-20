CREATE SCHEMA "reporting";
--> statement-breakpoint
CREATE VIEW "reporting"."responses" AS
SELECT
	"sub"."session_id" AS "session_id",
	"s"."form_id" AS "form_id",
	"s"."form_version" AS "form_version",
	"sub"."submitted_at" AS "submitted_at",
	"s"."access_mode" AS "access_mode",
	COALESCE(
		(
			SELECT jsonb_object_agg("elem"."item" ->> 'questionId', "elem"."item" -> 'value')
			FROM jsonb_array_elements("sub"."locked_answers" -> 'answers') AS "elem"("item")
		),
		'{}'::jsonb
	) AS "answers"
FROM "submissions" "sub"
JOIN "sessions" "s" ON "s"."session_id" = "sub"."session_id"
LEFT JOIN "erasure_tombstones" "t" ON "t"."session_id" = "sub"."session_id"
WHERE "s"."status" = 'submitted'
	AND "t"."session_id" IS NULL;
--> statement-breakpoint
CREATE VIEW "reporting"."answers_flat" AS
SELECT
	"r"."session_id" AS "session_id",
	"r"."form_id" AS "form_id",
	"r"."form_version" AS "form_version",
	"r"."submitted_at" AS "submitted_at",
	"kv"."key" AS "question_id",
	"kv"."value" AS "value"
FROM "reporting"."responses" "r"
CROSS JOIN LATERAL jsonb_each("r"."answers") AS "kv"("key", "value");
