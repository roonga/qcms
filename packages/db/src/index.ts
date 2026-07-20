/**
 * @qcms/db public surface (task 013): the Drizzle schema for the operational
 * skeleton — questions and versions, forms/drafts/versions, sessions, secure
 * links, the append-only answer ledger, submissions, erasure tombstones, the
 * transactional outbox, and the better-auth tables.
 *
 * Migrations live in `migrations/` and are the package-owned, append-only
 * history adopters apply with `drizzle-kit migrate` on upgrade. The Testcontainers
 * test harness (`withTestDb`) is intentionally not part of this runtime surface —
 * it is a test-only utility under `src/testing/` that depends on devDependencies.
 */

// Named table/enum exports (tree-shakeable, deep-import-free per the API rules).
export * from "./schema/index.js";

// Aggregate namespace for `drizzle(client, { schema })`.
export * as schema from "./schema/index.js";
