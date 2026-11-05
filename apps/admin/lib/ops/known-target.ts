import type { ErasureScope } from "./types.ts";

/** What the known-target lookup answered, as the screen holds it. */
export type KnownTargetLookup =
  | { readonly status: "found"; readonly scope: ErasureScope }
  | { readonly status: "missing" }
  | { readonly status: "error"; readonly message: string };

export type KnownTargetStep =
  | "ask"
  | "missing"
  | "failed"
  | "erasable"
  | "alreadyErased"
  | "erased";

/**
 * Where the known-target journey stands: asking for an id, refused, or with a session
 * found that is erasable, already erased, or erased by this visit. Only `erasable`
 * offers the act.
 */
export function knownTargetStep(
  lookup: KnownTargetLookup | null,
  erasedHere: boolean,
): KnownTargetStep {
  if (erasedHere) return "erased";
  if (lookup === null) return "ask";
  if (lookup.status === "missing") return "missing";
  if (lookup.status === "error") return "failed";
  return lookup.scope.alreadyErased ? "alreadyErased" : "erasable";
}
