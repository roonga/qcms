import type { z } from "zod";

/**
 * Shared plumbing for the schema modules whose parse helpers report every error
 * with a typed code: a refinement attaches its code to the Zod custom issue,
 * and a failed parse maps each issue back into the module's error shape,
 * falling back to its structural code.
 *
 * A caller wraps {@link addCodedIssue} in its own code enum, so a typo'd code
 * is a compile error rather than a silent fallback.
 */

/** Matches the shape of `QcmsError.extend({ code: <module enum> })`. */
export interface CodedError<Code extends string> {
  code: Code;
  message: string;
  path: (string | number)[];
}

/** Attach a typed code to a Zod custom issue, so a parse helper can surface it
 * instead of the generic structural code. */
export function addCodedIssue(
  ctx: z.core.$RefinementCtx,
  code: string,
  message: string,
  path: readonly (string | number)[],
): void {
  ctx.addIssue({ code: "custom", message, path: [...path], params: { qcms: code } });
}

/** `undefined` when no valid code was attached. */
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
 * union's path prefixed onto that branch's relative paths.
 *
 * A `z.union` reports one opaque issue whose path stops at the union node, which
 * costs a report its usefulness where a union stands in for what would
 * otherwise be a plain object: a malformed field would be reported at the item
 * rather than at the field an author's editor highlights.
 *
 * The condition is deliberately narrow, and that is the point. One branch must
 * have strictly the fewest issues, so it won outright rather than tying, and
 * its issues must sit deeper than the union node, so it accepted the shape and
 * disagreed about a field inside it. Either condition alone would change what
 * every other union here reports.
 *
 * Where every branch fails at the node itself, as a value union does, no branch
 * wins and the original message survives. Naming one branch there would be
 * worse than saying nothing, since "expected string" is a lie about a value a
 * number or a boolean would equally have satisfied.
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

/** An issue with no attached code carries the module's fallback code. */
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
