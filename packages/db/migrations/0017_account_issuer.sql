-- better-auth 1.7 keys an account on (issuer, accountId) rather than on accountId
-- alone, and validates the Drizzle mirror at startup: without this column every auth
-- request fails and sign-in returns 401.
--
-- NO COMPATIBILITY IS BEING PRESERVED HERE (Code Owner, 2026-08-25). QCMS is
-- pre-launch and there is no deployment whose account rows have to survive, so this
-- does not do the nullable-backfill-constrain dance the 1.7 upgrade guide prescribes
-- for a live database.
--
-- The default exists for one reason and is dropped immediately: `ADD COLUMN ... NOT
-- NULL` fails against a table that already has rows, and a developer's own stack has
-- an administrator in it. It spares them a teardown; it is not a claim about
-- migrating anyone's data. `local:credential` is the only issuer QCMS can have -
-- `createInitialAdmin` mints an email-and-password account, no social provider is
-- configured, and SEC-1's endpoint allowlist is what keeps that true - so the column
-- is faithful either way, and dropping the default keeps it matching the mirror,
-- which declares no default.
ALTER TABLE "account" ADD COLUMN "issuer" text NOT NULL DEFAULT 'local:credential';--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" DROP DEFAULT;--> statement-breakpoint
-- Declared by better-auth itself (`getAuthTables(...).account.indexes`), and the
-- constraint that makes the new identity meaningful: without it two rows could claim
-- one (issuer, accountId) and the lookup that replaced the old accountId-only one
-- would be ambiguous.
CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "account" ("issuer","accountId");
