// Render rollback from the API field, never infer it independently in client screens.

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

  readonly closed: boolean;
}

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
        closed: row.closed === true,
      },
    ];
  });
}

// Derive current release from the same history shown in the table so a second read cannot disagree.
export function currentReleaseByEnvironment(
  releases: readonly ReleaseRecord[],
): ReadonlyMap<string, ReleaseRecord> {
  const current = new Map<string, ReleaseRecord>();
  for (const release of releases) {
    if (!current.has(release.environment)) current.set(release.environment, release);
  }
  return current;
}

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

export function currentEnvironmentsByVersion(
  releases: readonly ReleaseRecord[],
): Readonly<Record<string, readonly string[]>> {
  const byVersion = new Map<string, string[]>();
  for (const release of currentReleaseByEnvironment(releases).values()) {
    const key = String(release.version);
    const seen = byVersion.get(key) ?? [];
    seen.push(release.environment);
    byVersion.set(key, seen);
  }
  return Object.fromEntries([...byVersion].map(([key, names]) => [key, [...names].sort()]));
}

export function releasedVersions(releases: readonly ReleaseRecord[]): ReadonlySet<number> {
  return new Set(releases.map((release) => release.version));
}
