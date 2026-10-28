import type { A2UINode } from "./types.js";

/**
 * The honeypot decoy field: a form-filler populating every input by name flags the session
 * with no tell in the response (SECURITY_DESIGN). The name is shared with the API and unlike
 * a question id (R6). A dedicated node type; `docs/a2ui-mapping.md` carries the contract.
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
