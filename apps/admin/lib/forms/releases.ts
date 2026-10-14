/**
 * The release record as the admin reads it, and the two readings its screens take of a
 * history (ADR-40, task 065).
 *
 * Client-safe and pure, like `lib/forms/publish.ts`: the version list and the release panel
 * are both client components, and a client module cannot reach into `lib/server/` at all
 * (the R2 import-surface test). So the type and the two derivations live here and
 * `lib/server/releases.ts` holds the calls.
 *
 * **Nothing here decides anything about a release.** `rollback` arrives on the row,
 * computed by the API from the release's own predecessor in that environment, so every
 * screen that shows the marking shows the same answer (criterion 4).
 */

/** One release, as the history and the release result both carry it. */
export interface ReleaseRecord {
  readonly formId: string;
  readonly environment: string;
  readonly version: number;
  readonly sequence: number;
  readonly fromEnvironment: string | null;
  readonly releasedBy: string;
  readonly releasedAt: string;
  readonly approvedBy: string | null;
  readonly replacedVersion: number | null;
  readonly rollback: boolean;
}

/** Shape-check the list, dropping any entry that is not a release row. */
export function parseReleases(value: unknown): readonly ReleaseRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as Partial<Record<keyof ReleaseRecord, unknown>>;
    if (
      typeof row.formId !== "string" ||
      typeof row.environment !== "string" ||
      typeof row.version !== "number" ||
      typeof row.sequence !== "number" ||
      typeof row.releasedBy !== "string" ||
      typeof row.releasedAt !== "string" ||
      typeof row.rollback !== "boolean"
    ) {
      return [];
    }
    return [
      {
        formId: row.formId,
        environment: row.environment,
        version: row.version,
        sequence: row.sequence,
        fromEnvironment: typeof row.fromEnvironment === "string" ? row.fromEnvironment : null,
        releasedBy: row.releasedBy,
        releasedAt: row.releasedAt,
        approvedBy: typeof row.approvedBy === "string" ? row.approvedBy : null,
        replacedVersion: typeof row.replacedVersion === "number" ? row.replacedVersion : null,
        rollback: row.rollback,
      },
    ];
  });
}

/**
 * The version released to each environment, newest release per environment.
 *
 * Derived from the history rather than read separately, because the history already carries
 * it: the newest row for a (form, environment) pair **is** what is released there (ADR-40),
 * and a second read would be a second answer that could disagree with the table beside it.
 * The history arrives newest first, so the first row seen for an environment is its current
 * release.
 */
export function currentReleaseByEnvironment(
  releases: readonly ReleaseRecord[],
): ReadonlyMap<string, ReleaseRecord> {
  const current = new Map<string, ReleaseRecord>();
  for (const release of releases) {
    if (!current.has(release.environment)) current.set(release.environment, release);
  }
  return current;
}

/**
 * Which environments each version has reached, keyed by version number.
 *
 * The version list's "released anywhere" filter and its Released column both read this.
 * "Has reached", not "is released to": a version released and then rolled away from still
 * reached that environment, and a filter that hid it would be a worse answer than the
 * unfiltered list.
 *
 * Each environment appears once per version, in the order the history gives them.
 */
export function environmentsByVersion(
  releases: readonly ReleaseRecord[],
): Readonly<Record<string, readonly string[]>> {
  const byVersion = new Map<string, string[]>();
  for (const release of releases) {
    const key = String(release.version);
    const seen = byVersion.get(key) ?? [];
    if (!seen.includes(release.environment)) seen.push(release.environment);
    byVersion.set(key, seen);
  }
  return Object.fromEntries(byVersion);
}

/** Every version that has reached any environment, for the version list's filter. */
export function releasedVersions(releases: readonly ReleaseRecord[]): ReadonlySet<number> {
  return new Set(releases.map((release) => release.version));
}
