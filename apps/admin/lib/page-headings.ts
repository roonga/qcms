/** Keep heading IDs in a dependency-free module shared across the server/client boundary. */

export const RESPONSE_HEADING_ID = "qcms-response-heading";

export const VERSION_HEADING_ID = "qcms-version-heading";

/** The rules editor reuses the route heading ID to avoid a second level-one heading. */
export function sectionHeadingId(section: string): string {
  return `qcms-${section}-heading`;
}
