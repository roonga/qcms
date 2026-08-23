import type { QuestionStatus, QuestionVersion } from "./types.ts";

/**
 * What the question detail screen's rail carries, as a decision rather than as markup
 * (issue 650, built to `plan/admin-shell-poc/question-editor-poc.html`).
 *
 * ## Why the rail carries versions here and steps everywhere else
 *
 * `docs/admin-constraints.md` says what binds this app: the POCs are the design, one per
 * screen. The question editor's POC draws a rail whose one group is this question's
 * versions, and states its own reason beside the markup - a question's only children are
 * its versions and it has no sibling screens, so the same rule that gives a form's rail
 * two groups gives a question's rail one. `plan/admin-design-contracts.md` §7 says the
 * same thing in a sentence; it is rationale for the shape rather than the authority for
 * it, and the drawing is what this module implements.
 *
 * ## Why this is a module and not four lines inside the component
 *
 * Two React trees are rendered from one URL and both have to agree about which version is
 * showing: the rail marks a row current, the screen renders that version's editor and
 * preview. Rather than pass the answer between a parallel route and a page that cannot see
 * each other, each asks {@link selectVersion} about the same query - the same device the
 * Settings rail uses for its section. A disagreement here would be a screen saying two
 * things, so the answer lives in one pure function that both import.
 */

/** One row of the rail's version group. */
export interface VersionRailItem {
  /** Stable per version, and the test hook a spec addresses a row by. */
  readonly key: string;
  readonly version: number;
  readonly href: string;
  readonly status: QuestionStatus;
  /** ISO instant, or `null` when this version has never been published. */
  readonly publishedAt: string | null;
  readonly isCurrent: boolean;
}

/**
 * ISO day.
 *
 * Rendered on the server, so no locale or timezone can shift it on hydration: a date
 * formatted here and the same date formatted in the browser would differ across the
 * international date line, and this one is a governance record.
 */
export function isoDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * Which version the address selects.
 *
 * Newest by default, because an author arriving from the library wants what is current,
 * not the v1 that has not been the answer for a year. A `?v` naming no version falls back
 * the same way rather than 404ing: the address is left as it was, which is what makes a
 * pasted link forgiving.
 */
export function selectVersion(
  versions: readonly QuestionVersion[],
  requested: string | string[] | undefined,
): QuestionVersion | undefined {
  const raw = Array.isArray(requested) ? requested[0] : requested;
  const wanted = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  const match = versions.find((version) => version.version === wanted);
  return match ?? versions[versions.length - 1];
}

/**
 * The version rows, newest first.
 *
 * Newest first is the POC's order and the shipped timeline's before it: the version an
 * author is most likely to want is the one they do not have to scroll a decade of history
 * to reach. Each row is an anchor to `?v={n}` on this same route, because a version is not
 * a route here, unlike `/forms/{id}/versions/{v}`, where a version is one.
 */
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

/**
 * The newest published version, or `null` when none has ever been published.
 *
 * The POC's digest line reads "4 versions, v3 published", so the number beside the count is
 * the one an operator would cite as "what is live". Deprecated versions are deliberately
 * not counted as published: a deprecated version blocks new pins, so naming it here would
 * tell an operator something is current that is not.
 */
export function latestPublishedVersion(versions: readonly QuestionVersion[]): number | null {
  let latest: number | null = null;
  for (const version of versions) {
    if (version.status === "published" && (latest === null || version.version > latest)) {
      latest = version.version;
    }
  }
  return latest;
}
