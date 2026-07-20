/**
 * Compile-time drift guards for the hand-authored row interfaces of the
 * enum-bearing tables (`forms`, `sessions`, `question_versions`) - issue #5.
 *
 * Drizzle's `$inferSelect` is sound *inside* this package, but it degrades to a
 * TypeScript `error` type across the package's **emitted `.d.ts`** boundary: the
 * `$inferSelect` mapped type over a `pgEnum`-bearing table does not survive
 * declaration emit, so `tsc` hides it under `skipLibCheck` while
 * `typescript-eslint`'s `no-unsafe-*` rules surface it as unsafe member access
 * in consuming packages (e.g. `apps/api`). Enum-free tables are unaffected.
 *
 * The fix is to export hand-authored interfaces for those rows and derive their
 * enum-member unions from the `pgEnum` definitions (whose literal tuples *do*
 * survive emit - see `dist/schema/enums.d.ts`). To keep each hand-authored
 * interface in lockstep with its Drizzle table, each row module asserts both
 * directions of `AssignableTo` between the hand-authored interface and
 * `typeof table.$inferSelect` here, where `$inferSelect` still resolves
 * correctly. Add, drop, or retype a column in `schema/*` and the assertion stops
 * compiling until the interface is brought back into step.
 *
 * This helper is intentionally NOT re-exported from the package index
 * (`queries/index.ts` names its exports); it is an internal invariant, not
 * public surface.
 */

/**
 * Resolves to `A` only when `A` is assignable to `B`; otherwise the `A extends B`
 * constraint fails and the instantiation is a typecheck error. One-directional,
 * so it is free of the "circular constraint" restriction a single bidirectional
 * parameter pair would hit. Instantiate it in **both** directions with concrete
 * types to assert structural equality (see the row modules). The `& B` keeps both
 * parameters referenced (they resolve to `A`, since `A extends B`).
 */
export type AssignableTo<A extends B, B> = A & B;
