import type { CSSProperties } from "react";

import type { HoneypotNode } from "./honeypot.schema.ts";

type HoneypotProps = NonNullable<HoneypotNode["props"]>;

/**
 * The visually-hidden decoy container (task 026 reference rendering). Off-screen
 * and clipped rather than `display:none` so a naive form-filler still "sees" a
 * fillable input, but assistive tech does not: the wrapper is `aria-hidden` and
 * the input carries no `<label>` and no accessible name. `tabIndex={-1}` keeps
 * the input out of the tab order (and satisfies axe `aria-hidden-focus`, which
 * only flags *tabbable* content inside `aria-hidden`).
 */
const HIDDEN_CONTAINER_STYLE: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

export function Honeypot({ name = "website" }: HoneypotProps) {
  return (
    <div aria-hidden="true" style={HIDDEN_CONTAINER_STYLE}>
      <input name={name} autoComplete="off" tabIndex={-1} />
    </div>
  );
}
