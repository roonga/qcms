import type { CSSProperties } from "react";

import type { HoneypotNode } from "./honeypot.schema.ts";

type HoneypotProps = NonNullable<HoneypotNode["props"]>;

// Clipped rather than `display: none`, so a naive form-filler still sees a fillable
// input while assistive technology does not. `tabIndex={-1}` keeps it out of the tab
// order, which also satisfies axe's `aria-hidden-focus` rule.

const HIDDEN_CONTAINER_STYLE: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

export function Honeypot({ name = "website" }: Readonly<HoneypotProps>) {
  return (
    <div aria-hidden="true" style={HIDDEN_CONTAINER_STYLE}>
      <input name={name} autoComplete="off" tabIndex={-1} />
    </div>
  );
}
