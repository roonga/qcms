import { defineConfig } from "drizzle-kit";

/**
 * `schema` points at the control plane alone, which is all drizzle-kit can express: the
 * data plane is one copy per environment, emitted by `src/environment/sql.ts` instead.
 * Pointing this at the flat schema index would emit every data-plane table once in the
 * default schema (ADR-40).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/control/index.ts",
  out: "./migrations",
  strict: true,
});
