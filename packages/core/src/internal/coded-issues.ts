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
 * Flatten a union failure to the branch that came closest, with the union's own
 * path prefixed onto the branch's relative paths.
 *
 * A `z.union` reports one opaque `invalid_union` issue whose path stops at the
 * union node and whose real detail sits in a nested array, one entry per branch.
 * That costs a report its usefulness wherever a union appears: a step item is a
 * pinned question **or** a repeating group since task 071 (ADR-42), so a pin
 * with a malformed `version` would otherwise be reported at
 * `steps[0].items[0]` rather than at `steps[0].items[0].version`, which is the
 * path an author's editor highlights.
 *
 * "Came closest" is the branch with the **fewest** issues, ties going to the
 * branch whose issues sit **deepest**, which is the branch that matched most of
 * the structure before disagreeing. Both halves earn their keep on real input:
 * a pin with a fractional `version` fails the question-ref branch once and the
 * repeating-group branch five times, so the count decides; a group nested
 * inside a group fails both branches twice, and the depth is what points the
 * report at the nested group rather than at the outer group's missing
 * `questionId`.
 *
 * It is a heuristic rather than a proof of intent, and it is the right one here
 * because the alternatives are worse: reporting every branch's issues would
 * tell an author who wrote a question ref what a repeating group needs, and
 * reporting none is what the union already does.
 */
function expandUnionIssue(issue: z.core.$ZodIssue): readonly z.core.$ZodIssue[] {
  if (issue.code !== "invalid_union") {
    return [issue];
  }
  const depthOf = (branch: readonly z.core.$ZodIssue[]): number =>
    Math.max(...branch.map((nested) => nested.path.length));
  let best: readonly z.core.$ZodIssue[] | undefined;
  for (const branch of issue.errors) {
    if (branch.length === 0) {
      continue;
    }
    if (
      best === undefined ||
      branch.length < best.length ||
      (branch.length === best.length && depthOf(branch) > depthOf(best))
    ) {
      best = branch;
    }
  }
  if (best === undefined) {
    return [issue];
  }
  return best.flatMap((nested) =>
    expandUnionIssue({ ...nested, path: [...issue.path, ...nested.path] } as z.core.$ZodIssue),
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
