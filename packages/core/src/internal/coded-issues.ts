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

/** Map every issue of a failed parse to a typed error; issues without an
 * attached code (structural failures) carry the module's fallback code. */
export function toCodedErrors<Code extends string>(
  codeSchema: z.ZodType<Code>,
  error: z.ZodError,
  fallback: Code,
): readonly CodedError<Code>[] {
  return error.issues.map((issue) => ({
    code: qcmsCodeOf(codeSchema, issue) ?? fallback,
    message: issue.message,
    path: issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
  }));
}
