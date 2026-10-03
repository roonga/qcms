CREATE SCHEMA "control";
--> statement-breakpoint
CREATE TYPE "control"."access_mode" AS ENUM('anonymous', 'secure_link');--> statement-breakpoint
CREATE TYPE "control"."form_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "control"."question_status" AS ENUM('draft', 'published', 'deprecated');--> statement-breakpoint
CREATE TYPE "control"."session_status" AS ENUM('created', 'in_progress', 'submitted', 'expired');--> statement-breakpoint
CREATE TABLE "control"."question_versions" (
	"question_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"status" "control"."question_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "question_versions_question_id_version_pk" PRIMARY KEY("question_id","version"),
	CONSTRAINT "question_versions_version_positive" CHECK ("control"."question_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "control"."questions" (
	"question_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "control"."form_drafts" (
	"form_id" text PRIMARY KEY NOT NULL,
	"definition" jsonb NOT NULL,
	"agent_assisted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control"."form_versions" (
	"form_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"compiled" jsonb NOT NULL,
	"compiler_version" text NOT NULL,
	"a2ui_spec_version" text NOT NULL,
	"semantics_version" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_versions_form_id_version_pk" PRIMARY KEY("form_id","version"),
	CONSTRAINT "form_versions_version_positive" CHECK ("control"."form_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "control"."forms" (
	"form_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"default_locale" text NOT NULL,
	"status" "control"."form_status" DEFAULT 'open' NOT NULL,
	"challenge_required" boolean DEFAULT false NOT NULL,
	"min_submit_ms" integer
);
--> statement-breakpoint
CREATE TABLE "control"."secure_links" (
	"link_id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"one_time" boolean DEFAULT false NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"environment" text NOT NULL,
	CONSTRAINT "secure_links_link_environment_uq" UNIQUE("link_id","environment")
);
--> statement-breakpoint
CREATE TABLE "control"."environments" (
	"name" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"challenge_provider" text,
	"delivery_snippet_ttl_ms" bigint,
	"outbox_payload_ttl_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_position_unique" UNIQUE("position")
);
--> statement-breakpoint
CREATE TABLE "control"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control"."invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"teamId" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"inviterId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control"."member" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control"."organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"metadata" text,
	"isShared" boolean DEFAULT false NOT NULL,
	"requireSecondApprover" boolean DEFAULT false NOT NULL,
	"archivedAt" timestamp,
	"seedNewEditorsWithTestData" boolean DEFAULT false NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "control"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"activeOrganizationId" text,
	"activeTeamId" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "control"."team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"memberCount" integer DEFAULT 0 NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"role" text NOT NULL,
	"environments" text[] NOT NULL,
	"forms" text[] NOT NULL,
	"externalGroupId" text,
	CONSTRAINT "team_externalGroupId_unique" UNIQUE("externalGroupId")
);
--> statement-breakpoint
CREATE TABLE "control"."teamMember" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"userId" text NOT NULL,
	"membershipKey" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "teamMember_membershipKey_unique" UNIQUE("membershipKey")
);
--> statement-breakpoint
CREATE TABLE "control"."twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failedVerificationCount" integer DEFAULT 0,
	"lockedUntil" timestamp
);
--> statement-breakpoint
CREATE TABLE "control"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"twoFactorEnabled" boolean,
	"role" text DEFAULT 'admin' NOT NULL,
	"mustChangePassword" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "control"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control"."two_factor_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"database_role" text NOT NULL,
	"cleared_factors" integer NOT NULL,
	"was_enrolled" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control"."question_versions" ADD CONSTRAINT "question_versions_question_id_questions_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "control"."questions"("question_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."form_drafts" ADD CONSTRAINT "form_drafts_form_id_forms_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "control"."forms"("form_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."form_versions" ADD CONSTRAINT "form_versions_form_id_forms_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "control"."forms"("form_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."secure_links" ADD CONSTRAINT "secure_links_form_id_forms_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "control"."forms"("form_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."invitation" ADD CONSTRAINT "invitation_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."invitation" ADD CONSTRAINT "invitation_inviterId_user_id_fk" FOREIGN KEY ("inviterId") REFERENCES "control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."member" ADD CONSTRAINT "member_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."member" ADD CONSTRAINT "member_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."team" ADD CONSTRAINT "team_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."teamMember" ADD CONSTRAINT "teamMember_teamId_team_id_fk" FOREIGN KEY ("teamId") REFERENCES "control"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."teamMember" ADD CONSTRAINT "teamMember_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "control"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- ===========================================================================
-- Everything above this line is generated by `drizzle-kit generate` from the
-- CONTROL-PLANE schema module. Everything below is HAND-AUTHORED, because
-- drizzle-kit has no notion of N copies of one table in N schemas whose names
-- come from a database row (ADR-40, Q41). It is emitted by
-- `packages/db/src/environment/baseline.ts` and asserted by `baseline.test.ts`;
-- re-run `pnpm --filter @roonga/qcms-db db:emit-baseline` after changing the
-- data-plane schema module rather than editing the SQL below by hand.
-- ===========================================================================
-- `public` holds no QCMS object at all and is on no search path (Q20, criterion 2).
-- PostgreSQL 15 already revokes CREATE on it from PUBLIC; stated here so the property
-- is a thing this migration establishes rather than a default it inherits, and so a
-- database restored onto an older cluster gets it too.
REVOKE CREATE ON SCHEMA "public" FROM PUBLIC;
--> statement-breakpoint
-- The answer ledger is append-only (I5, R3). Any UPDATE is rejected, in every
-- environment. One body in `control`, executed by one trigger per `data_<env>`.
CREATE FUNCTION control.answers_reject_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'answers are append-only (I5): UPDATE is rejected'
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Scoped DELETE door for the ledger (ADR-17). DELETE is rejected unless the
-- transaction-local guard `qcms.allow_answer_delete` is set to 'on', which only the
-- two sanctioned whole-session doors do: `eraseSession` and `purgeExpired`. SET LOCAL
-- reverts at transaction end, so the door is never left open.
--
-- `current_setting(..., missing_ok => true)` returns NULL when the GUC was never set,
-- so `IS DISTINCT FROM 'on'` rejects the un-flagged case and permits only 'on'.
CREATE FUNCTION control.answers_reject_delete() RETURNS trigger AS $$
BEGIN
	IF current_setting('qcms.allow_answer_delete', true) IS DISTINCT FROM 'on' THEN
		RAISE EXCEPTION 'answers DELETE is only permitted via the sanctioned erasure/retention path (ADR-17)'
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Once published, a question version's definition is frozen (I1). Status may still
-- transition and published_at may be set; the definition JSONB may not change.
CREATE FUNCTION control.question_versions_freeze_published() RETURNS trigger AS $$
BEGIN
	IF OLD.status = 'published' AND NEW.definition IS DISTINCT FROM OLD.definition THEN
		RAISE EXCEPTION 'published question_versions.definition is immutable (I1): UPDATE is rejected'
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "question_versions_freeze_published"
	BEFORE UPDATE ON control."question_versions"
	FOR EACH ROW EXECUTE FUNCTION control.question_versions_freeze_published();
--> statement-breakpoint
-- Published form versions are immutable (R1, I1). No UPDATE path exists.
CREATE FUNCTION control.form_versions_reject_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'form_versions are immutable (R1, I1): UPDATE is rejected'
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "form_versions_reject_update"
	BEFORE UPDATE ON control."form_versions"
	FOR EACH ROW EXECUTE FUNCTION control.form_versions_reject_update();
--> statement-breakpoint
-- The live set every per-environment job reads (Q1). A fresh database is created
-- with exactly these two; further rows are written by the environment command.
INSERT INTO control."environments" ("name", "position") VALUES ('test', 1), ('prod', 2);
--> statement-breakpoint
CREATE SCHEMA "data_test";
--> statement-breakpoint
CREATE TABLE "data_test"."sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"form_version" integer NOT NULL,
	"access_mode" control."access_mode" NOT NULL,
	"link_id" text,
	"environment" text NOT NULL,
	"status" control."session_status" DEFAULT 'created' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_environment_matches" CHECK ("sessions"."environment" = 'test')
);
--> statement-breakpoint
CREATE TABLE "data_test"."answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"question_id" text NOT NULL,
	"instance_id" text,
	"value" jsonb,
	"retracted" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_retraction_value" CHECK (("answers"."retracted" AND "answers"."value" IS NULL) OR (NOT "answers"."retracted" AND "answers"."value" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "data_test"."answer_group_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"group_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"event" text NOT NULL,
	"op_token" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_group_instances_event" CHECK ("answer_group_instances"."event" IN ('added', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "data_test"."submissions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"locked_answers" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"flagged_reason" text
);
--> statement-breakpoint
CREATE TABLE "data_test"."erasure_tombstones" (
	"session_id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"form_version" integer NOT NULL,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_test"."outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dead_lettered_at" timestamp with time zone,
	"last_error" text,
	"payload_redacted_at" timestamp with time zone,
	CONSTRAINT "outbox_redacted_payload_has_no_answers" CHECK ("outbox"."payload_redacted_at" is null or not jsonb_exists("outbox"."payload", 'answers'))
);
--> statement-breakpoint
CREATE TABLE "data_test"."webhooks" (
	"webhook_id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"url" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_test"."webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"webhook_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"last_error" text,
	"last_attempt_at" timestamp with time zone,
	"last_status" integer,
	"last_latency_ms" integer,
	"last_request_headers" jsonb,
	"last_response_snippet" text,
	"last_response_snippet_redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	CONSTRAINT "webhook_deliveries_event_webhook_uq" UNIQUE("outbox_id","webhook_id"),
	CONSTRAINT "webhook_deliveries_snippet_requires_attempt" CHECK ("webhook_deliveries"."last_response_snippet" is null or "webhook_deliveries"."last_attempt_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "data_test"."sessions" ADD CONSTRAINT "sessions_form_version_fk" FOREIGN KEY ("form_id","form_version") REFERENCES "control"."form_versions"("form_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_test"."sessions" ADD CONSTRAINT "sessions_secure_link_fk" FOREIGN KEY ("link_id","environment") REFERENCES "control"."secure_links"("link_id","environment") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_test"."answers" ADD CONSTRAINT "answers_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "data_test"."sessions"("session_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_test"."answer_group_instances" ADD CONSTRAINT "answer_group_instances_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "data_test"."sessions"("session_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_test"."submissions" ADD CONSTRAINT "submissions_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "data_test"."sessions"("session_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_test"."webhooks" ADD CONSTRAINT "webhooks_form_id_forms_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "control"."forms"("form_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_test"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_outbox_id_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "data_test"."outbox"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_test"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "data_test"."webhooks"("webhook_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sessions_status_expires_at_idx" ON "data_test"."sessions" USING btree("status","expires_at");
--> statement-breakpoint
CREATE INDEX "answers_session_question_answered_at_idx" ON "data_test"."answers" USING btree("session_id","question_id","instance_id","answered_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "answer_group_instances_session_group_occurred_at_idx" ON "data_test"."answer_group_instances" USING btree("session_id","group_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "outbox_delivery_idx" ON "data_test"."outbox" USING btree("delivered_at","next_attempt_at") WHERE "outbox"."dead_lettered_at" is null;
--> statement-breakpoint
CREATE INDEX "outbox_payload_retention_idx" ON "data_test"."outbox" USING btree(greatest("outbox"."delivered_at", "outbox"."dead_lettered_at")) WHERE "outbox"."payload_redacted_at" is null and jsonb_exists("outbox"."payload", 'answers');
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "data_test"."webhook_deliveries" USING btree("delivered_at","next_attempt_at") WHERE "webhook_deliveries"."dead_lettered_at" is null;
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_snippet_retention_idx" ON "data_test"."webhook_deliveries" USING btree("last_attempt_at") WHERE "webhook_deliveries"."last_response_snippet" is not null;
--> statement-breakpoint
-- the answer ledger is append-only (I5): every UPDATE is rejected
CREATE TRIGGER "answers_reject_update"
	BEFORE UPDATE ON "data_test"."answers"
	FOR EACH ROW EXECUTE FUNCTION control."answers_reject_update"();
--> statement-breakpoint
-- DELETE passes only through the two sanctioned whole-session doors (ADR-17)
CREATE TRIGGER "answers_reject_delete"
	BEFORE DELETE ON "data_test"."answers"
	FOR EACH ROW EXECUTE FUNCTION control."answers_reject_delete"();
--> statement-breakpoint
-- the roster is append-only (I5, ADR-42): every UPDATE is rejected
CREATE TRIGGER "answer_group_instances_reject_update"
	BEFORE UPDATE ON "data_test"."answer_group_instances"
	FOR EACH ROW EXECUTE FUNCTION control."answer_group_instances_reject_update"();
--> statement-breakpoint
-- DELETE passes only through the two sanctioned whole-session doors (ADR-17)
CREATE TRIGGER "answer_group_instances_reject_delete"
	BEFORE DELETE ON "data_test"."answer_group_instances"
	FOR EACH ROW EXECUTE FUNCTION control."answer_group_instances_reject_delete"();
--> statement-breakpoint
CREATE SCHEMA "reporting_test";
--> statement-breakpoint
CREATE VIEW "reporting_test"."responses" AS
SELECT
	"sub"."session_id" AS "session_id",
	"s"."form_id" AS "form_id",
	"s"."form_version" AS "form_version",
	"sub"."submitted_at" AS "submitted_at",
	"s"."access_mode" AS "access_mode",
	COALESCE("agg"."answers", '{}'::jsonb) AS "answers"
FROM "data_test"."submissions" "sub"
JOIN "data_test"."sessions" "s" ON "s"."session_id" = "sub"."session_id"
LEFT JOIN "data_test"."erasure_tombstones" "t" ON "t"."session_id" = "sub"."session_id"
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
				FROM "data_test"."answer_group_instances" "agi"
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
CREATE VIEW "reporting_test"."answers_flat" AS
SELECT
	"r"."session_id" AS "session_id",
	"r"."form_id" AS "form_id",
	"r"."form_version" AS "form_version",
	"r"."submitted_at" AS "submitted_at",
	"unpivoted"."question_id" AS "question_id",
	"unpivoted"."value" AS "value",
	"unpivoted"."instance_id" AS "instance_id"
FROM "reporting_test"."responses" "r"
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
--> statement-breakpoint
CREATE SCHEMA "data_prod";
--> statement-breakpoint
CREATE TABLE "data_prod"."sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"form_version" integer NOT NULL,
	"access_mode" control."access_mode" NOT NULL,
	"link_id" text,
	"environment" text NOT NULL,
	"status" control."session_status" DEFAULT 'created' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_environment_matches" CHECK ("sessions"."environment" = 'prod')
);
--> statement-breakpoint
CREATE TABLE "data_prod"."answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"question_id" text NOT NULL,
	"instance_id" text,
	"value" jsonb,
	"retracted" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_retraction_value" CHECK (("answers"."retracted" AND "answers"."value" IS NULL) OR (NOT "answers"."retracted" AND "answers"."value" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "data_prod"."answer_group_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"group_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"event" text NOT NULL,
	"op_token" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_group_instances_event" CHECK ("answer_group_instances"."event" IN ('added', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "data_prod"."submissions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"locked_answers" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"flagged_reason" text
);
--> statement-breakpoint
CREATE TABLE "data_prod"."erasure_tombstones" (
	"session_id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"form_version" integer NOT NULL,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_prod"."outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dead_lettered_at" timestamp with time zone,
	"last_error" text,
	"payload_redacted_at" timestamp with time zone,
	CONSTRAINT "outbox_redacted_payload_has_no_answers" CHECK ("outbox"."payload_redacted_at" is null or not jsonb_exists("outbox"."payload", 'answers'))
);
--> statement-breakpoint
CREATE TABLE "data_prod"."webhooks" (
	"webhook_id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"url" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_prod"."webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"webhook_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"last_error" text,
	"last_attempt_at" timestamp with time zone,
	"last_status" integer,
	"last_latency_ms" integer,
	"last_request_headers" jsonb,
	"last_response_snippet" text,
	"last_response_snippet_redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	CONSTRAINT "webhook_deliveries_event_webhook_uq" UNIQUE("outbox_id","webhook_id"),
	CONSTRAINT "webhook_deliveries_snippet_requires_attempt" CHECK ("webhook_deliveries"."last_response_snippet" is null or "webhook_deliveries"."last_attempt_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "data_prod"."sessions" ADD CONSTRAINT "sessions_form_version_fk" FOREIGN KEY ("form_id","form_version") REFERENCES "control"."form_versions"("form_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_prod"."sessions" ADD CONSTRAINT "sessions_secure_link_fk" FOREIGN KEY ("link_id","environment") REFERENCES "control"."secure_links"("link_id","environment") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_prod"."answers" ADD CONSTRAINT "answers_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "data_prod"."sessions"("session_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_prod"."answer_group_instances" ADD CONSTRAINT "answer_group_instances_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "data_prod"."sessions"("session_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_prod"."submissions" ADD CONSTRAINT "submissions_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "data_prod"."sessions"("session_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_prod"."webhooks" ADD CONSTRAINT "webhooks_form_id_forms_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "control"."forms"("form_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_prod"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_outbox_id_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "data_prod"."outbox"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_prod"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "data_prod"."webhooks"("webhook_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sessions_status_expires_at_idx" ON "data_prod"."sessions" USING btree("status","expires_at");
--> statement-breakpoint
CREATE INDEX "answers_session_question_answered_at_idx" ON "data_prod"."answers" USING btree("session_id","question_id","instance_id","answered_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "answer_group_instances_session_group_occurred_at_idx" ON "data_prod"."answer_group_instances" USING btree("session_id","group_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "outbox_delivery_idx" ON "data_prod"."outbox" USING btree("delivered_at","next_attempt_at") WHERE "outbox"."dead_lettered_at" is null;
--> statement-breakpoint
CREATE INDEX "outbox_payload_retention_idx" ON "data_prod"."outbox" USING btree(greatest("outbox"."delivered_at", "outbox"."dead_lettered_at")) WHERE "outbox"."payload_redacted_at" is null and jsonb_exists("outbox"."payload", 'answers');
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "data_prod"."webhook_deliveries" USING btree("delivered_at","next_attempt_at") WHERE "webhook_deliveries"."dead_lettered_at" is null;
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_snippet_retention_idx" ON "data_prod"."webhook_deliveries" USING btree("last_attempt_at") WHERE "webhook_deliveries"."last_response_snippet" is not null;
--> statement-breakpoint
-- the answer ledger is append-only (I5): every UPDATE is rejected
CREATE TRIGGER "answers_reject_update"
	BEFORE UPDATE ON "data_prod"."answers"
	FOR EACH ROW EXECUTE FUNCTION control."answers_reject_update"();
--> statement-breakpoint
-- DELETE passes only through the two sanctioned whole-session doors (ADR-17)
CREATE TRIGGER "answers_reject_delete"
	BEFORE DELETE ON "data_prod"."answers"
	FOR EACH ROW EXECUTE FUNCTION control."answers_reject_delete"();
--> statement-breakpoint
-- the roster is append-only (I5, ADR-42): every UPDATE is rejected
CREATE TRIGGER "answer_group_instances_reject_update"
	BEFORE UPDATE ON "data_prod"."answer_group_instances"
	FOR EACH ROW EXECUTE FUNCTION control."answer_group_instances_reject_update"();
--> statement-breakpoint
-- DELETE passes only through the two sanctioned whole-session doors (ADR-17)
CREATE TRIGGER "answer_group_instances_reject_delete"
	BEFORE DELETE ON "data_prod"."answer_group_instances"
	FOR EACH ROW EXECUTE FUNCTION control."answer_group_instances_reject_delete"();
--> statement-breakpoint
CREATE SCHEMA "reporting_prod";
--> statement-breakpoint
CREATE VIEW "reporting_prod"."responses" AS
SELECT
	"sub"."session_id" AS "session_id",
	"s"."form_id" AS "form_id",
	"s"."form_version" AS "form_version",
	"sub"."submitted_at" AS "submitted_at",
	"s"."access_mode" AS "access_mode",
	COALESCE("agg"."answers", '{}'::jsonb) AS "answers"
FROM "data_prod"."submissions" "sub"
JOIN "data_prod"."sessions" "s" ON "s"."session_id" = "sub"."session_id"
LEFT JOIN "data_prod"."erasure_tombstones" "t" ON "t"."session_id" = "sub"."session_id"
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
				FROM "data_prod"."answer_group_instances" "agi"
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
CREATE VIEW "reporting_prod"."answers_flat" AS
SELECT
	"r"."session_id" AS "session_id",
	"r"."form_id" AS "form_id",
	"r"."form_version" AS "form_version",
	"r"."submitted_at" AS "submitted_at",
	"unpivoted"."question_id" AS "question_id",
	"unpivoted"."value" AS "value",
	"unpivoted"."instance_id" AS "instance_id"
FROM "reporting_prod"."responses" "r"
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
--> statement-breakpoint
-- `qcms_app_control` serves better-auth, authoring, grants, releases and closes, so
-- it holds DML on the whole of `control` - with the audit tables carved out below and
-- in task 069's migration. In the data schemas it holds INSERT on `outbox` and nothing
-- else at all (Q49), which the per-environment block above grants.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qcms_app_control') THEN
		EXECUTE 'GRANT USAGE ON SCHEMA "control" TO "qcms_app_control"';
		EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "control" TO "qcms_app_control"';
		EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA "control" TO "qcms_app_control"';
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qcms_app_test') THEN
		EXECUTE 'GRANT USAGE ON SCHEMA "data_test" TO "qcms_app_test"';
		EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "data_test" TO "qcms_app_test"';
		EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA "data_test" TO "qcms_app_test"';
		EXECUTE 'GRANT USAGE ON SCHEMA "reporting_test" TO "qcms_app_test"';
		EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA "reporting_test" TO "qcms_app_test"';
		EXECUTE 'GRANT USAGE ON SCHEMA "control" TO "qcms_app_test"';
		EXECUTE 'GRANT SELECT ON "control"."forms" TO "qcms_app_test"';
		EXECUTE 'GRANT SELECT ON "control"."form_versions" TO "qcms_app_test"';
		EXECUTE 'GRANT SELECT ON "control"."question_versions" TO "qcms_app_test"';
		EXECUTE 'GRANT SELECT ON "control"."secure_links" TO "qcms_app_test"';
		EXECUTE 'GRANT SELECT ON "control"."environments" TO "qcms_app_test"';
		EXECUTE 'GRANT UPDATE ON "control"."secure_links" TO "qcms_app_test"';
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qcms_app_test')
		AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'control' AND tablename = 'form_releases') THEN
		EXECUTE 'GRANT SELECT ON "control"."form_releases" TO "qcms_app_test"';
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qcms_app_control') THEN
		EXECUTE 'GRANT USAGE ON SCHEMA "data_test" TO "qcms_app_control"';
		EXECUTE 'GRANT INSERT ON "data_test"."outbox" TO "qcms_app_control"';
	END IF;
END
$$;
--> statement-breakpoint
DO $$
DECLARE application_role text;
BEGIN
	FOR application_role IN
		SELECT rolname FROM pg_roles WHERE rolname LIKE 'qcms\_app%'
	LOOP
		EXECUTE format(
			'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE control.two_factor_resets FROM %I',
			application_role);
	END LOOP;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qcms_app_prod') THEN
		EXECUTE 'GRANT USAGE ON SCHEMA "data_prod" TO "qcms_app_prod"';
		EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "data_prod" TO "qcms_app_prod"';
		EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA "data_prod" TO "qcms_app_prod"';
		EXECUTE 'GRANT USAGE ON SCHEMA "reporting_prod" TO "qcms_app_prod"';
		EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA "reporting_prod" TO "qcms_app_prod"';
		EXECUTE 'GRANT USAGE ON SCHEMA "control" TO "qcms_app_prod"';
		EXECUTE 'GRANT SELECT ON "control"."forms" TO "qcms_app_prod"';
		EXECUTE 'GRANT SELECT ON "control"."form_versions" TO "qcms_app_prod"';
		EXECUTE 'GRANT SELECT ON "control"."question_versions" TO "qcms_app_prod"';
		EXECUTE 'GRANT SELECT ON "control"."secure_links" TO "qcms_app_prod"';
		EXECUTE 'GRANT SELECT ON "control"."environments" TO "qcms_app_prod"';
		EXECUTE 'GRANT UPDATE ON "control"."secure_links" TO "qcms_app_prod"';
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qcms_app_prod')
		AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'control' AND tablename = 'form_releases') THEN
		EXECUTE 'GRANT SELECT ON "control"."form_releases" TO "qcms_app_prod"';
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qcms_app_control') THEN
		EXECUTE 'GRANT USAGE ON SCHEMA "data_prod" TO "qcms_app_control"';
		EXECUTE 'GRANT INSERT ON "data_prod"."outbox" TO "qcms_app_control"';
	END IF;
END
$$;
--> statement-breakpoint
DO $$
DECLARE application_role text;
BEGIN
	FOR application_role IN
		SELECT rolname FROM pg_roles WHERE rolname LIKE 'qcms\_app%'
	LOOP
		EXECUTE format(
			'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE control.two_factor_resets FROM %I',
			application_role);
	END LOOP;
END
$$;
--> statement-breakpoint
DO $$
DECLARE application_role text;
BEGIN
	FOR application_role IN
		SELECT rolname FROM pg_roles WHERE rolname LIKE 'qcms\_app%'
	LOOP
		EXECUTE format(
			'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE control.two_factor_resets FROM %I',
			application_role);
	END LOOP;
END
$$;
