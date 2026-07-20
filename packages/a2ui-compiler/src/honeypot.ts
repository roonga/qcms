import type { A2UINode } from "./types.js";

/**
 * Honeypot decoy field (task 026, abuse controls).
 *
 * Every compiled step document carries one visually-hidden decoy field. A real
 * respondent never sees or fills it (it is off-screen, removed from the
 * accessibility tree, and outside the tab order); an automated form-filler that
 * blindly populates every input by `name`/`type` fills it, and the submit slice
 * (020) silently flags that session (`HONEYPOT`) — same success-shaped response,
 * no tell (SECURITY: the flag must never leak to the caller).
 *
 * **The field contract shared with the API.** The decoy submits under
 * {@link HONEYPOT_FIELD_NAME}; the submit handler reads the same well-known name
 * off the request body (`config.antiAbuse.honeypotField`, defaulted to this
 * constant). Compiler and API therefore agree on exactly one string — change it
 * in one place. It deliberately does *not* look like a qcms question id
 * (`q_…`, R6), so it can never collide with a real control's `name`.
 *
 * **Why a dedicated `Honeypot` node type, not a `TextField`.** A honeypot must
 * be rendered specially — off-screen, `aria-hidden`, `tabindex="-1"`,
 * `autocomplete="off"` — which no real form control does; and the `@a2ra/core`
 * `TextField` schema is `strict` and carries none of those hiding props. A
 * dedicated node makes the intent unmistakable (it can never be confused with a
 * real field) and self-describing. The renderer (028) recognizes the type and
 * emits the hidden wrapper below; this is a **renderer-compat contract** it must
 * honor (`packages/a2ui-compiler/golden/README.md`, `docs/a2ui-mapping.md`).
 *
 * Reference rendering the renderer (028) must produce (the a11y contract this
 * task asserts at the DOM level; the live axe pass is 028/030):
 *
 * ```html
 * <div aria-hidden="true"
 *      style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;">
 *   <input name="website" autocomplete="off" tabindex="-1" />
 * </div>
 * ```
 *
 * No `<label>` and no accessible name: the field is invisible to assistive tech
 * (excluded by the `aria-hidden` ancestor) and unreachable by keyboard.
 */

/** The well-known submit-body key the decoy field posts under (compiler ↔ API contract). */
export const HONEYPOT_FIELD_NAME = "website";

/** The A2UI node `type` literal the renderer (028) special-cases as a hidden decoy. */
export const HONEYPOT_NODE_TYPE = "Honeypot";

/**
 * The single decoy node appended (last) to every step document's field list.
 * Deterministic and side-effect free — the same node every time, so it is
 * frozen into the compiled snapshot via `compilerVersion` like every other
 * mapping constant. The hiding props travel with the node so the renderer needs
 * no out-of-band knowledge:
 *
 * - `name` — the shared honeypot field name (the submit key).
 * - `autoComplete: "off"` — password managers / browsers never prefill it.
 * - `ariaHidden: true` — removed from the accessibility tree (screen-reader invisible).
 * - `tabIndex: -1` — skipped by keyboard tabbing.
 */
export function honeypotNode(): A2UINode {
  return {
    type: HONEYPOT_NODE_TYPE,
    props: {
      name: HONEYPOT_FIELD_NAME,
      autoComplete: "off",
      ariaHidden: true,
      tabIndex: -1,
    },
  };
}
