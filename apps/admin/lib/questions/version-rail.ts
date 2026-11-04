import type { QuestionStatus, QuestionVersion } from "./types.ts";

// The page and parallel rail must resolve the same version from one address; neither tree can pass props to the other.

export interface VersionRailItem {
  readonly key: string;
  readonly version: number;
  readonly href: string;
  readonly status: QuestionStatus;

  readonly publishedAt: string | null;
  readonly isCurrent: boolean;
}

// Unknown version bookmarks fall back to newest without rewriting the address.
export function selectVersion(
  versions: readonly QuestionVersion[],
  requested: string | string[] | undefined,
): QuestionVersion | undefined {
  const raw = Array.isArray(requested) ? requested[0] : requested;
  const wanted = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  const match = versions.find((version) => version.version === wanted);
  return match ?? versions[versions.length - 1];
}

export function versionRailItems(
  questionId: string,
  versions: readonly QuestionVersion[],
  selected: number,
): readonly VersionRailItem[] {
  const base = `/questions/${encodeURIComponent(questionId)}`;
  return [...versions].reverse().map((version) => ({
    key: `v${String(version.version)}`,
    version: version.version,
    href: `${base}?v=${String(version.version)}`,
    status: version.status,
    publishedAt: version.publishedAt,
    isCurrent: version.version === selected,
  }));
}

// Exclude deprecated versions from the published digest because they cannot accept new pins.
export function latestPublishedVersion(versions: readonly QuestionVersion[]): number | null {
  let latest: number | null = null;
  for (const version of versions) {
    if (version.status === "published" && (latest === null || version.version > latest)) {
      latest = version.version;
    }
  }
  return latest;
}
