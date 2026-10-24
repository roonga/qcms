import type { A2UINode } from "./types.js";

/**
 * The honeypot decoy field. A respondent never reaches it, being off-screen,
 * out of the accessibility tree and out of the tab order; a form-filler that
 * populates every input by name fills it, and the submit slice flags that
 * session with no tell in the response (SECURITY_DESIGN).
 *
 * The compiler and the API agree on the one field name below, so it changes in
 * one place, and it deliberately does not look like a question id (R6), so it
 * cannot collide with a real control's `name`.
 *
 * A dedicated node type rather than a `TextField`, because the hiding props no
 * real control carries are not in the vendored strict schema (ADR-22). The
 * renderer must honour it: the contract is in `docs/a2ui-mapping.md` and the
 * golden corpus.
 */

/** The submit-body key the decoy posts under, shared with the API. */
export const HONEYPOT_FIELD_NAME = "website";

/** The node type the renderer special-cases as a hidden decoy. */
export const HONEYPOT_NODE_TYPE = "Honeypot";

/**
 * The hiding props travel with the node, so the renderer needs no out-of-band
 * knowledge: no prefill, out of the accessibility tree, out of the tab order.
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
