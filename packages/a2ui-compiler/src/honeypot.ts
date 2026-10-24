import type { A2UINode } from "./types.js";

/**
 * The honeypot decoy field. A respondent never reaches it; a form-filler that
 * populates every input by name does, and the submit slice flags that session
 * with no tell in the response (SECURITY_DESIGN). The field name is shared with
 * the API and deliberately unlike a question id (R6). A dedicated node type:
 * the hiding props are not in the vendored strict schema (ADR-22), so
 * `docs/a2ui-mapping.md` and the golden corpus carry the contract.
 */

/** The submit-body key the decoy posts under, shared with the API. */
export const HONEYPOT_FIELD_NAME = "website";

/** The node type the renderer special-cases as a hidden decoy. */
export const HONEYPOT_NODE_TYPE = "Honeypot";

/**
 * Travels with the node, so the renderer needs nothing out of band: no prefill,
 * out of the accessibility tree, out of the tab order.
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
