/**
 * The review and the confirmation, as the publish wizard reads them (phase 5, issue #1197).
 *
 * Client-safe and pure, like `lib/forms/releases.ts`, because the wizard is a client
 * component and a client module cannot reach into `lib/server/` at all (the R2
 * import-surface test). The calls live in `lib/server/releases.ts`.
 *
 * **Nothing here decides whether a destination is eligible.** `blockers` arrive on each
 * target, computed by the API from committed state, so the wizard disables a destination
 * the server has already refused rather than running a second rule set of its own.
 */

/** A committed release row that satisfied a destination's prerequisite. */
export interface ReleaseEvidenceRecord {
  readonly environment: string;
  readonly version: number;
  readonly sequence: number;
  readonly releasedAt: string;
}

/** One reason a destination is accessible but not releasable right now. */
export interface ReleaseBlockerRecord {
  readonly code: string;
  /** Environments any one of which would satisfy a prerequisite; empty otherwise. */
  readonly requiresAnyOf: readonly string[];
}

/** One destination the caller holds `release: create` in. There are no others. */
export interface ReviewTarget {
  readonly environment: string;
  readonly currentVersion: number | null;
  /**
   * The newest release-state sequence, `null` for never released there. The confirmation
   * carries it back, so a close, a reopen or a release landing in between is refused
   * rather than committed over.
   */
  readonly currentSequence: number | null;
  readonly closed: boolean;
  readonly evidence: readonly ReleaseEvidenceRecord[];
  readonly blockers: readonly ReleaseBlockerRecord[];
  readonly twoPerson: { readonly applies: boolean; readonly refusedAsAuthor: boolean };
  readonly protected: boolean;
}

/** The source a review considered: the shared draft, or one exact immutable version. */
export type ReviewSource =
  | { readonly kind: "draft"; readonly draftRevision: number }
  | { readonly kind: "version"; readonly version: number; readonly publishedBy: string | null };

export interface ReleaseReview {
  readonly source: ReviewSource;
  readonly workflowRevision: number | null;
  readonly workflowSource: "default" | "configured";
  readonly targets: readonly ReviewTarget[];
}

/** What the wizard asks for, as plain data: the shape task 083 will later drive. */
export type PublishIntent =
  | { readonly kind: "draft"; readonly draftRevision: number }
  | { readonly kind: "version"; readonly version: number };

/** One chosen destination, carrying the sequence the review reported for it. */
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

/** Shape-check a review. `undefined` is "this answer was not a review", not "no targets". */
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

/**
 * Whether this destination can be confirmed as it stands.
 *
 * A blocker is the server's refusal reported early, and the two-person rule is the one
 * refusal the review states separately rather than as a blocker when the source is a
 * version this account did not publish. Both read the same way here: anything that would
 * make the confirmation fail disables the destination with a reason beside it.
 */
export function isTargetEligible(target: ReviewTarget): boolean {
  return target.blockers.length === 0 && !target.twoPerson.refusedAsAuthor;
}

/** The destinations a confirmation may carry, in the order the review reported them. */
export function eligibleTargets(review: ReleaseReview): readonly ReviewTarget[] {
  return review.targets.filter((target) => isTargetEligible(target));
}
