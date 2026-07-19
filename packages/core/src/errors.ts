import { z } from "zod";

/**
 * Base shape for every typed error the kernel produces (task 002).
 * Later error models (PublishError, ValidationError, ...) extend this shape
 * with their own closed `code` unions; the base keeps `code` open so the
 * schema composes forward without relitigating codes here.
 */
export const QcmsError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});
export type QcmsError = z.infer<typeof QcmsError>;

/**
 * Typed result for expected failures (CONTRIBUTING: exceptions are for bugs
 * only and never cross a package boundary as control flow).
 * .NET mapping: like a `Result<T, E>` / OneOf return instead of throwing.
 */
export type Result<T, E = QcmsError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}

/** Construct a QcmsError without repeating the object literal shape. */
export function qcmsError(
  code: string,
  message: string,
  path?: readonly (string | number)[],
): QcmsError {
  return path === undefined ? { code, message } : { code, message, path: [...path] };
}
