CREATE TABLE "two_factor_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"database_role" text NOT NULL,
	"cleared_factors" integer NOT NULL,
	"was_enrolled" boolean NOT NULL
);
--> statement-breakpoint
-- The break-glass audit table is MIGRATE-ONLY (issue #432, Code Owner decision
-- 2026-09-09). Everything above this line is generated; this block is hand-authored,
-- the way 0001's triggers are.
--
-- `two_factor_resets` records that somebody removed an authentication factor out of
-- band. The credential that performs the reset is the migration role, and the whole
-- point of SEC-10's split is that the credential serving traffic is not that one - so
-- an audit row the application credential can UPDATE or DELETE is an audit row that
-- proves nothing against the one attacker the split is drawn against.
--
-- It has to be a REVOKE rather than a narrower grant. The db-roles recipe hands
-- qcms_app the DML pass with `GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
-- public` plus `ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES`, and neither form
-- can name an exception: default privileges are keyed on (role, schema, object type)
-- and have no per-table filter, so "every table this role creates except that one"
-- is not expressible. The grant lands and is taken back.
--
-- Here, in the migration, because this is the only place that runs as the table's
-- owner in the same step that creates it. A fresh scaffold is `db-roles` then
-- `migrate`, so the table does not exist while the recipe runs and a revoke there
-- would have nothing to revoke from; putting it here means a scaffolded deployment is
-- correct with no post-migrate step for an operator to forget. The recipe carries its
-- own guarded revoke as well, for the separate reason that db-roles re-runs on every
-- `up` and would otherwise re-grant this on the next boot.
--
-- Guarded on the role existing, because most databases this runs against have no
-- qcms_app: the Testcontainers harness migrates as the container's superuser, and so
-- does a single-credential development database. An unguarded REVOKE would fail with
-- "role qcms_app does not exist" and take every one of those with it.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qcms_app') THEN
		EXECUTE 'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE two_factor_resets FROM qcms_app';
	END IF;
END
$$;
