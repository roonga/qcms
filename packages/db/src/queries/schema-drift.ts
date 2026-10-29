// `$inferSelect` over a `pgEnum`-bearing or branded table degrades to an `error` type through the emitted
// `.d.ts`, so these rows are hand-authored and policed here, where `$inferSelect` resolves.

/**
 * One-directional, to avoid the circular-constraint restriction a bidirectional parameter
 * pair would hit; instantiate it in both directions to assert structural equality.
 */
export type AssignableTo<A extends B, B> = A & B;
