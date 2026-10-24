// `$inferSelect` over a `pgEnum`-bearing or branded table is sound inside this package
// but degrades to an `error` type through the emitted `.d.ts`, which `typescript-eslint`
// surfaces as unsafe member access in consuming packages (issue #5). Those rows are
// therefore hand-authored and policed here, where `$inferSelect` still resolves.

/**
 * One-directional, to avoid the circular-constraint restriction a bidirectional parameter
 * pair would hit; instantiate it in both directions to assert structural equality.
 */
export type AssignableTo<A extends B, B> = A & B;
