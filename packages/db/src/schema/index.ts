/**
 * The @qcms/db schema surface — every table, enum, and index that migrations
 * are generated from (`drizzle-kit generate` reads this module). Postgres stores
 * and indexes the domain JSONB but never interprets it; the kernel (`@qcms/core`)
 * owns every invariant, and the database enforces the immutability and
 * append-only backstops via triggers (migration 0001).
 */

export * from "./enums.js";
export * from "./questions.js";
export * from "./forms.js";
export * from "./secure-links.js";
export * from "./webhooks.js";
export * from "./sessions.js";
export * from "./answers.js";
export * from "./submissions.js";
export * from "./erasure.js";
export * from "./outbox.js";
export * from "./deliveries.js";
export * from "./auth.js";
