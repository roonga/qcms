// Keep client-safe view types outside server modules; the API owns eligibility decisions.

export interface ReleaseEvidenceRecord {
  readonly environment: string;
  readonly version: number;
  readonly sequence: number;
  readonly releasedAt: string;
}

export interface ReleaseBlockerRecord {
  readonly code: string;

  readonly requiresAnyOf: readonly string[];
}

export interface ReviewTarget {
  readonly environment: string;
  readonly currentVersion: number | null;
  // Echo the observed release sequence so intervening close, reopen or release operations make confirmation stale.
  readonly currentSequence: number | null;
  readonly closed: boolean;
  readonly evidence: readonly ReleaseEvidenceRecord[];
  readonly blockers: readonly ReleaseBlockerRecord[];
  readonly twoPerson: { readonly applies: boolean; readonly refusedAsAuthor: boolean };
  readonly protected: boolean;
}

export type ReviewSource =
  | { readonly kind: "draft"; readonly draftRevision: number }
  | { readonly kind: "version"; readonly version: number; readonly publishedBy: string | null };

export interface ReleaseReview {
  readonly source: ReviewSource;
  readonly workflowRevision: number | null;
  readonly workflowSource: "default" | "configured";
  readonly targets: readonly ReviewTarget[];
}

export type PublishIntent =
  | { readonly kind: "draft"; readonly draftRevision: number }
  | { readonly kind: "version"; readonly version: number };

export interface PublishDestination {
  readonly environment: string;
  readonly expectedSequence: number | null;
  readonly fromEnvironment?: string;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readEvidence(value: unknown): readonly ReleaseEvidenceRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as Partial<Record<keyof ReleaseEvidenceRecord, unknown>>;
    if (
      typeof row.environment !== "string" ||
      typeof row.version !== "number" ||
      typeof row.sequence !== "number" ||
      typeof row.releasedAt !== "string"
    ) {
      return [];
    }
    return [
      {
        environment: row.environment,
        version: row.version,
        sequence: row.sequence,
        releasedAt: row.releasedAt,
      },
    ];
  });
}

function readBlockers(value: unknown): readonly ReleaseBlockerRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as { code?: unknown; requiresAnyOf?: unknown };
    if (typeof row.code !== "string") return [];
    return [{ code: row.code, requiresAnyOf: readStringArray(row.requiresAnyOf) }];
  });
}

function readSource(value: unknown): ReviewSource | undefined {
  const row = value as {
    kind?: unknown;
    draftRevision?: unknown;
    version?: unknown;
    publishedBy?: unknown;
  };
  if (row.kind === "draft" && typeof row.draftRevision === "number") {
    return { kind: "draft", draftRevision: row.draftRevision };
  }
  if (row.kind === "version" && typeof row.version === "number") {
    return {
      kind: "version",
      version: row.version,
      publishedBy: typeof row.publishedBy === "string" ? row.publishedBy : null,
    };
  }
  return undefined;
}

function readTargets(value: unknown): readonly ReviewTarget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as Record<string, unknown>;
    if (typeof row.environment !== "string") return [];
    const twoPerson = (row.twoPerson ?? {}) as { applies?: unknown; refusedAsAuthor?: unknown };
    return [
      {
        environment: row.environment,
        currentVersion: typeof row.currentVersion === "number" ? row.currentVersion : null,
        currentSequence: typeof row.currentSequence === "number" ? row.currentSequence : null,
        closed: row.closed === true,
        evidence: readEvidence(row.evidence),
        blockers: readBlockers(row.blockers),
        twoPerson: {
          applies: twoPerson.applies === true,
          refusedAsAuthor: twoPerson.refusedAsAuthor === true,
        },
        protected: row.protected === true,
      },
    ];
  });
}

// An unreadable review is not an empty destination list.
export function parseReleaseReview(value: unknown): ReleaseReview | undefined {
  const body = value as {
    source?: unknown;
    workflowRevision?: unknown;
    workflowSource?: unknown;
    targets?: unknown;
  };
  const source = readSource(body.source);
  if (source === undefined) return undefined;
  return {
    source,
    workflowRevision: typeof body.workflowRevision === "number" ? body.workflowRevision : null,
    workflowSource: body.workflowSource === "configured" ? "configured" : "default",
    targets: readTargets(body.targets),
  };
}

export function isTargetEligible(target: ReviewTarget): boolean {
  return target.blockers.length === 0 && !target.twoPerson.refusedAsAuthor;
}

export function eligibleTargets(review: ReleaseReview): readonly ReviewTarget[] {
  return review.targets.filter((target) => isTargetEligible(target));
}
