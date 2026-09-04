/**
 * Ids of the page-level `<h1>` on the two form routes whose subject is one CHILD of the
 * form rather than the form itself (issue #510).
 *
 * They live here, in a leaf module with no imports, because both ends need them and the
 * ends are on opposite sides of the server/client boundary: the route composes the
 * heading through `FormPageHeader` (server), and the component that renders the rest of
 * the page points its `aria-labelledby` at it (client). Importing the id from either of
 * those modules would drag the other's bundle along with it.
 */

/** The response detail route's heading, "Response {sessionId}". */
export const RESPONSE_HEADING_ID = "qcms-response-heading";

/** The version detail route's heading, "Version {version}". */
export const VERSION_HEADING_ID = "qcms-version-heading";
