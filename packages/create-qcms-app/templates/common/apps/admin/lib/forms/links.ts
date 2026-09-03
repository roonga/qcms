import { csvFieldAlwaysQuoted } from "@qcms/csv";

import type { MessageKey } from "../i18n/en.ts";

import type { LinkState, MintedLink } from "./types.ts";

/**
 * Secure-link presentation helpers (task 034).
 *
 * Pure functions over what the API already decided. State derivation belongs to the API
 * (024) and is not re-implemented here: this module turns a state into a catalog key and a
 * mint result into a file, and does nothing else.
 */

/** The catalog key naming each lifecycle state. Spelled out, never colour alone (WCAG 1.4.1). */
const STATE_LABELS: Readonly<Record<LinkState, MessageKey>> = {
  active: "forms.links.state.active",
  consumed: "forms.links.state.consumed",
  expired: "forms.links.state.expired",
  revoked: "forms.links.state.revoked",
};

/** The message key for one link state. */
export function linkStateKey(state: LinkState): MessageKey {
  return STATE_LABELS[state];
}

/** Whether a link is still closeable. Only a live link can be revoked. */
export function isRevocable(state: LinkState): boolean {
  return state === "active";
}

/** The CSV export's column order, which is also its header row. */
const CSV_COLUMNS = ["linkId", "url", "expiresAt"] as const;

/**
 * Render a batch of freshly minted links as CSV.
 *
 * Client-side from the mint result, because the mint response is the **only** place a
 * link URL ever exists: the API stores a state row and never the token, so an export
 * assembled from the links list could not contain a single usable URL. That is also why
 * the export offers the batch that was just minted rather than "all links".
 *
 * CRLF line endings, because RFC 4180 says so and because it is the ending every
 * spreadsheet program on every platform reads without a prompt.
 *
 * Fields come from `@qcms/csv`, shared with the API's response export (issue #470). The
 * always-quoted policy is this export's own: a link URL contains no comma, quote or
 * newline today, and quoting anyway means a field that grows a separator later cannot
 * silently shift every column. The formula-injection guard the helper also applies is the
 * one this file used to own alone.
 */
export function mintedLinksCsv(links: readonly MintedLink[]): string {
  const header = CSV_COLUMNS.map(csvFieldAlwaysQuoted).join(",");
  const rows = links.map((link) =>
    [link.linkId, link.url, link.expiresAt].map(csvFieldAlwaysQuoted).join(","),
  );
  return [header, ...rows].join("\r\n");
}

/** The download filename for a batch export, scoped to the form it belongs to. */
export function mintedLinksFilename(formId: string): string {
  const safe = formId.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  return `${safe}-links.csv`;
}
