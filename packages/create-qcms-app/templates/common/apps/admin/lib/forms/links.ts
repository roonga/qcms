import { csvFieldAlwaysQuoted } from "@roonga/qcms-csv";

import type { MessageKey } from "../i18n/en.ts";

import type { LinkState, MintedLink } from "./types.ts";

const STATE_LABELS: Readonly<Record<LinkState, MessageKey>> = {
  active: "forms.links.state.active",
  consumed: "forms.links.state.consumed",
  expired: "forms.links.state.expired",
  revoked: "forms.links.state.revoked",
};

export function linkStateKey(state: LinkState): MessageKey {
  return STATE_LABELS[state];
}

export function isRevocable(state: LinkState): boolean {
  return state === "active";
}

const CSV_COLUMNS = ["linkId", "url", "expiresAt"] as const;

// Export only mint results because the API never stores bearer URLs for listing. Use RFC 4180 CRLF records for spreadsheet compatibility.
export function mintedLinksCsv(links: readonly MintedLink[]): string {
  const header = CSV_COLUMNS.map(csvFieldAlwaysQuoted).join(",");
  const rows = links.map((link) =>
    [link.linkId, link.url, link.expiresAt].map(csvFieldAlwaysQuoted).join(","),
  );
  return [header, ...rows].join("\r\n");
}

export function mintedLinksFilename(formId: string): string {
  const safe = formId.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  return `${safe}-links.csv`;
}

/* Delay object-URL revocation so the browser has time to start the download. */
const REVOKE_DELAY_MS = 60_000;

/** Build the CSV in the browser: sending bearer URLs back to a server would widen their exposure. */
export function downloadMintedLinks(formId: string, links: readonly MintedLink[]): void {
  const blob = new Blob([mintedLinksCsv(links)], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = mintedLinksFilename(formId);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(href);
  }, REVOKE_DELAY_MS);
}

/** Report the outcome in words; a bearer address is never put where it could be announced. */
export async function copyMintedUrl(url: string): Promise<MessageKey> {
  try {
    // clipboard may be absent in an insecure context despite lib.dom types, and that access throws
    // synchronously.
    await navigator.clipboard.writeText(url);
    return "forms.links.copied";
  } catch {
    return "forms.links.copyFailed";
  }
}
