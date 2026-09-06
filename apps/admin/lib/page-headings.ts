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

/**
 * The id of the DEFAULT `<h1>` a form section screen renders, derived from the section.
 *
 * The two ids above exist because a route overrides its heading; this exists because a
 * route does not. `/forms/{formId}/rules` heads itself with the section's own name, which
 * the breadcrumb directly above it already says, so the heading is visually hidden - and a
 * hidden heading is still what labels the region beneath it. `RulesEditor` points its
 * `aria-labelledby` here rather than minting a second heading of its own, which is what
 * would otherwise put two level-one headings on one screen.
 *
 * Derived rather than enumerated so a section cannot be added with an id nobody wrote.
 */
export function sectionHeadingId(section: string): string {
  return `qcms-${section}-heading`;
}
