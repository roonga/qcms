import type { z } from "zod";

import { err, ok, qcmsError, type Result } from "../errors.js";

/**
 * Internal bridge from Zod's safeParse to the kernel's typed Result shape:
 * every public `parseX` helper fails with a stable qcms error code instead of
 * leaking ZodError as control flow across the package boundary.
 */
export function parseWithCode<S extends z.ZodType>(
  schema: S,
  code: string,
  label: string,
  value: unknown,
): Result<z.infer<S>> {
  const result = schema.safeParse(value);
  if (result.success) {
    return ok(result.data);
  }
  const detail = result.error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");
  return err(qcmsError(code, `${label}: ${detail}`));
}
