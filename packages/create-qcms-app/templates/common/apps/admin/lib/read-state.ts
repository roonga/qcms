/** A failed read is not an empty result. Carry only the discriminator to clients, leaving API error details with the page alert; keep independent capabilities usable. */

export type ReadState<T> = { readonly ok: true; readonly data: T } | { readonly ok: false };

const FAILED: ReadState<never> = { ok: false };

/** Accept the result structurally so client-safe view types do not import a server module. */
export function readState<T>(
  result: { readonly ok: true; readonly data: T } | { readonly ok: false },
): ReadState<T> {
  return result.ok ? { ok: true, data: result.data } : FAILED;
}
