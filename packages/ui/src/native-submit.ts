import type { A2Node } from "@a2ra/core";

/**
 * Native (no-JS) submit mode for the A2UI step renderer (task 044).
 *
 * The controlled renderer (028/029) owns the step `<form>` but renders its
 * primary action OUTSIDE the renderer as a `type="button"`, and each control is
 * a *controlled* react-aria input driven by parent state - so a respondent with
 * JavaScript disabled can VIEW a step but has nothing to submit. This module is
 * the opt-in seam that makes a step natively submittable: a real
 * `<form method="post" action=...>` the browser POSTs without JS, react-aria
 * inputs rendered *uncontrolled* (so their native form serialization carries the
 * user's input), and a real `type="submit"` control.
 *
 * ADR-18 is respected: the submittability is a *render-time* capability, never a
 * change to the stored compiled document. `withNativeSubmit` shallow-clones the
 * step's root at render time to inject the form `action`/`method` and append the
 * submit control; the persisted A2UI bytes are untouched (exactly as
 * `documentForVisible` already prunes at render time in the portal).
 */

/** The registry type of the appended, render-time-only submit control. */
export const SUBMIT_NODE_TYPE = "SubmitButton";

/**
 * The hidden-input name prefix that tags each answer field with its wire kind, so
 * the strict BFF can decode form-encoded strings back to canonical answer shapes
 * (boolean/number/...) WITHOUT knowing the question definitions (R2 stays intact:
 * the renderer, which knows each control's semantics, provides the transport kind;
 * the BFF is a dumb decoder). For question `q_x` the companion field is
 * `__qk__q_x` and its value is a {@link NativeFieldKind}.
 */
export const NATIVE_FIELD_KIND_PREFIX = "__qk__";

/**
 * The transport kind the BFF decoder keys off. Deliberately coarse - it is a
 * serialization hint, not the question type:
 *
 * - `string` - text / date / singleChoice / Select: the raw string, as-is.
 * - `number` - NumberField: coerce with `Number(...)`.
 * - `radio` - a RadioGroup: `"true"`/`"false"` decode to a JSON boolean (a boolean
 *   question), any other value stays a string (a singleChoice OptionId).
 * - `multi` - a CheckboxGroup: the array of selected string values.
 */
export type NativeFieldKind = "string" | "number" | "radio" | "multi";

/** Options that turn the renderer into its natively-submittable mode (opt-in). */
export interface NativeSubmitOptions {
  /** The same-origin BFF route the native `<form>` POSTs to. */
  readonly action: string;
  /** The form method; only `post` is meaningful for an answer submission. */
  readonly method?: "post";
  /** The visible label of the real submit control. */
  readonly submitLabel: string;
  /** Optional class for the submit control, so the host app themes it (ADR-26). */
  readonly submitClassName?: string;
}

/** Normalize an `A2Node`'s `children` union to a plain array of child nodes. */
function toChildArray(children: A2Node["children"]): A2Node[] {
  if (children === undefined) return [];
  if (typeof children === "string") return [];
  return Array.isArray(children) ? [...children] : [children];
}

/**
 * Return a render-time copy of the step's root that is natively submittable:
 * the (compiled `Form`) root gains `action`/`method`, and a `SubmitButton` node
 * is appended as its last child. The input `root` is never mutated (ADR-18); this
 * is the same render-time shaping the portal already does when it prunes to the
 * visible questions.
 *
 * A non-`Form` root (never produced by the compiler, but the type allows it) is
 * returned untouched apart from the appended submit control, since only a `<form>`
 * can carry `action`/`method`.
 */
export function withNativeSubmit(root: A2Node, opts: NativeSubmitOptions): A2Node {
  const submitProps: Record<string, unknown> = { label: opts.submitLabel };
  if (opts.submitClassName !== undefined) submitProps.className = opts.submitClassName;
  const submitNode: A2Node = { type: SUBMIT_NODE_TYPE, props: submitProps };

  const props: Record<string, unknown> = {
    ...(root.props ?? {}),
    action: opts.action,
    method: opts.method ?? "post",
  };
  return { ...root, props, children: [...toChildArray(root.children), submitNode] };
}
