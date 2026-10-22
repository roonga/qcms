/**
 * One SQL string literal helper, for the modules that build statement text (issue #1094).
 *
 * # Why this is its own module
 *
 * There were three copies of this four-line function: `environment/sql.ts`,
 * `environment/reporting.ts` and `reporting-views.ts`, identical in body and differing
 * only in name (`literal` twice, `sqlLiteral` once). Two of them predate issue #1094 and
 * the third was added by it, which is what PR #1099's round-2 review called out: a PR
 * whose central argument is that the grant model is one copy and not two should not leave
 * a third copy of the quoting rule behind it.
 *
 * The rule itself is small but it is a **correctness** rule, not a formatting one. Every
 * caller renders a value into DDL that cannot be parameterized - a view's `WHERE`
 * predicate, a `GRANT` over a generated name, a CHECK constraint - so the doubling is the
 * last thing standing between a workspace slug or an environment name and the statement
 * text. One copy means one place to read it, and one place a future fix lands.
 *
 * # Why a leaf module rather than a home in one of the three
 *
 * It imports nothing, so no caller gains a dependency by importing it. `reporting-views.ts`
 * has no imports at all and builds pure text; `environment/sql.ts` is the environment
 * generator layer. Putting the helper in either would have pointed one of those at the
 * other for a string function, and the odd edge would have been the thing a reader
 * noticed. It is deliberately **not** re-exported from `index.ts`: callers outside this
 * package build statements through the generators, not by quoting values themselves.
 *
 * Note what this is not. It is not an escape hatch that makes arbitrary input safe to
 * concatenate: every caller still refuses its input first (`refuseEnvironmentName`,
 * `WORKSPACE_SLUG_PATTERN`, `refuseWorkspaceReportingNames`), and this function is the
 * second line rather than the first.
 */

/**
 * `'test'` from `test`: a SQL string literal, with the doubling rule.
 *
 * `''` is how SQL escapes a quote inside a literal, so `o'brien` renders as `'o''brien'`.
 * `replaceAll` and not a regular expression: there is no flag to get wrong.
 */
export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
