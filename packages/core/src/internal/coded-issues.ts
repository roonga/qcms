import type { z } from "zod";

/**
 * Shared plumbing for schema modules whose parse helpers are
 * all-errors-not-first with typed codes (question-definition,
 * form-definition): refinements attach their qcms code to the Zod custom
 * issue via `params.qcms`, and a failed parse maps every ZodError issue back
 * into the module's `QcmsError`-extending error shape, falling back to the
 * module's structural code for issues without an attached one.
 *
 * Callers keep a thin module-local wrapper around {@link addCodedIssue} typed
 * to their own code enum so a typo'd code is a compile error, not a fallback.
 */

/** One typed error mapped from a Zod issue. Matches the shape of
 * `QcmsError.extend({ code: <module enum> })`. */
export interface CodedError<Code extends string> {
  code: Code;
  message: string;
  path: (string | number)[];
}

/** Attach a typed qcms code to a Zod custom issue so the parse helpers can
 * surface it instead of the generic structural code. */
export function addCodedIssue(
  ctx: z.core.$RefinementCtx,
  code: string,
  message: string,
  path: readonly (string | number)[],
): void {
  ctx.addIssue({ code: "custom", message, path: [...path], params: { qcms: code } });
}

/** Extract the typed qcms code from a custom issue, if a valid one was attached. */
function qcmsCodeOf<Code extends string>(
  codeSchema: z.ZodType<Code>,
  issue: z.core.$ZodIssue,
): Code | undefined {
  if (issue.code !== "custom") {
    return undefined;
  }
  const params: unknown = issue.params;
  if (params === null || typeof params !== "object") {
    return undefined;
  }
  const raw: unknown = (params as Record<string, unknown>)["qcms"];
  const parsed = codeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Flatten a union failure to the one branch that clearly came closest, with the
 * union's own path prefixed onto that branch's relative paths.
 *
 * A `z.union` reports one opaque `invalid_union` issue whose path stops at the
 * union node and whose real detail sits in a nested array, one entry per branch.
 * That costs a report its usefulness where a union stands in for a shape that
 * used to be a plain object: a step item is a pinned question **or** a repeating
 * group since task 071 (ADR-42), and without this a pin with a malformed
 * `version` would be reported at `steps[0].items[0]` rather than at
 * `steps[0].items[0].version`, which is the path an author's editor highlights
 * and the path this repository reported before the union existed.
 *
 * **The condition is deliberately narrow, and the narrowness is the point.**
 * Flattening happens only when
 *
 * 1. exactly one branch has the **strictly fewest** issues, so one branch won
 *    outright rather than tying; **and**
 * 2. that branch's issues sit **deeper than the union node**, so it accepted the
 *    shape and disagreed about a field inside it, rather than failing at the
 *    node the way a wrong primitive type does.
 *
 * Either condition alone would reach unions that were here before task 071 and
 * change what they report, which is not this function's business. On
 * `AnswerValue`, `Comparable` and a rule's `show` target, every branch fails at
 * the node itself with one issue each, so no branch wins outright and none sits
 * deeper: the original "Invalid input" survives, byte for byte, message
 * included. Naming one of those branches would be worse than saying nothing,
 * because "expected string" is a lie about a value where a number, a boolean, a
 * date or an option list would each have been accepted.
 *
 * On the step-item union a malformed pin fails the question-ref branch once,
 * inside the item, and the repeating-group branch four or five times, so it
 * clears both conditions and the report is the one this repository had before.
 * A group nested inside a group fails both branches twice and is reported at the
 * item, which is where the union itself failed and is honest about it.
 */
function expandUnionIssue(issue: z.core.$ZodIssue): readonly z.core.$ZodIssue[] {
  if (issue.code !== "invalid_union") {
    return [issue];
  }
  const branches = issue.errors.filter((branch) => branch.length > 0);
  if (branches.length === 0) {
    return [issue];
  }
  const fewest = Math.min(...branches.map((branch) => branch.length));
  const winners = branches.filter((branch) => branch.length === fewest);
  const best = winners[0];
  if (winners.length !== 1 || best === undefined) {
    return [issue]; // A tie is not a winner, and a tie is the ordinary case.
  }
  if (best.every((nested) => nested.path.length === 0)) {
    return [issue]; // It failed at the node, so it says nothing the node did not.
  }
  return best.flatMap((nested) =>
    expandUnionIssue({ ...nested, path: [...issue.path, ...nested.path] }),
  );
}

/** Map every issue of a failed parse to a typed error; issues without an
 * attached code (structural failures) carry the module's fallback code. */
export function toCodedErrors<Code extends string>(
  codeSchema: z.ZodType<Code>,
  error: z.ZodError,
  fallback: Code,
): readonly CodedError<Code>[] {
  return error.issues.flatMap(expandUnionIssue).map((issue) => ({
    code: qcmsCodeOf(codeSchema, issue) ?? fallback,
    message: issue.message,
    path: issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
  }));
}
