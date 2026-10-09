import { defineConfig } from "drizzle-kit";

/**
 * Authoring-time config for `drizzle-kit generate` (offline schema diff -> SQL).
 *
 * **It points at the control plane alone, and that is the whole of what drizzle-kit
 * can express** (ADR-40, Q41). The control plane is one copy, in the `control` schema,
 * so a diff against a snapshot is exactly the right tool for it. The **data plane** is
 * one copy per environment in `data_<env>`, and drizzle-kit has no notion of N copies
 * of one table in N schemas whose names come from a database row - so it is emitted by
 * `src/environment/sql.ts` from `src/schema/data/`, hand-authored into the baseline
 * below the generated portion, with a comment saying which is which. Pointing this at
 * the flat schema index instead would emit every data-plane table once, in the default
 * schema, which is the layout this design replaces.
 *
 * The append-only and immutability triggers stay hand-authored custom SQL for the same
 * reason they always were: they are not expressible as Drizzle schema.
 *
 * Migration history is append-only and immutable once released (ADR-18). The one
 * exception is the Q41 re-baseline this task carries, which is a Code Owner-approved
 * exception available exactly once, because Q22 says there is no installation to break.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/control/index.ts",
  out: "./migrations",
  strict: true,
});
