import { z } from "zod";

/** Each error model extends this with its own closed `code` union. */
export const QcmsError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});
export type QcmsError = z.infer<typeof QcmsError>;

/**
 * The shape expected failures take: an exception is for bugs only and never
 * crosses a package boundary as control flow (CONTRIBUTING).
 */
export type Result<T, E = QcmsError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}

export function qcmsError(
  code: string,
  message: string,
  path?: readonly (string | number)[],
): QcmsError {
  return path === undefined ? { code, message } : { code, message, path: [...path] };
}
