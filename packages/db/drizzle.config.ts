import { defineConfig } from "drizzle-kit";

/**
 * Authoring-time config for `drizzle-kit generate` (offline schema diff → SQL).
 * The immutability/append-only triggers are hand-authored custom SQL appended
 * after the generated table migration (see `migrations/0001_*.sql`); they are
 * not expressible as Drizzle schema. Migration history is append-only and
 * immutable once released (ADR-18 discipline) - never edit a released file.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  strict: true,
});
