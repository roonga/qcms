-- ===========================================================================
-- HAND-AUTHORED, and first: the access-group shape changed from one role plus a
-- form scope to a set of roles plus one environment set, and the old role
-- vocabulary has no mapping onto the new one (`docs/WORKSPACE_ACCESS.md`
-- sections 1 and 3). Every stored group is removed rather than guessed at, which
-- is also what lets `roles` be added NOT NULL below. `teamMember` cascades, so
-- the holders go with the groups and an administrator grants them again.
-- ===========================================================================
DELETE FROM "control"."team";--> statement-breakpoint
ALTER TABLE "control"."organization" DROP COLUMN "seedNewEditorsWithTestData";--> statement-breakpoint
ALTER TABLE "control"."team" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "control"."team" DROP COLUMN "forms";--> statement-breakpoint
ALTER TABLE "control"."team" ADD COLUMN "roles" text[] NOT NULL;