import type { FormDetail } from "./types.ts";

// Public form addresses are distinct from bearer secure links, which the API mints and reveals only once.
export function publicFormLink(
  detail: Pick<FormDetail, "slug" | "versions">,
  portalBaseUrl: string | undefined,
): string | undefined {
  if (portalBaseUrl === undefined || portalBaseUrl.trim() === "") return undefined;
  if (detail.versions.length === 0) return undefined;
  try {
    return new URL(`/f/${encodeURIComponent(detail.slug)}`, portalBaseUrl).toString();
  } catch {
    return undefined;
  }
}
