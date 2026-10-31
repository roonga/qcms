import {
  getDraft,
  getFormEnvironmentState,
  getLatestPublishedVersion,
  getReleaseBatch,
  insertReleaseBatch,
  listFormReleases,
  lockForm,
} from "@roonga/qcms-db";
import type { Executor, FormReleaseHistoryRow } from "@roonga/qcms-db";
import type { FormId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { approvalForRelease } from "../membership/two-person.js";
import { recordRelease } from "./release.js";
import {
  batchNotAllowed,
  readWorkflow,
  requireDraftEligible,
  requirePrerequisite,
  ruleFor,
  type EffectiveWorkflow,
} from "./workflow.js";

/** One destination of a confirmation, carrying what the review showed. */
export interface BatchTarget {
  readonly environment: string;
  /**
   * The newest release-state sequence the review reported, `null` for never released
   * there. A close, a reopen and a release each append a row, so this one expectation
   * covers the released version and the intake state together.
   */
  readonly expectedSequence: number | null;
  readonly fromEnvironment?: string | undefined;
}

/** What the confirmation releases: an existing version, or a draft frozen in the act. */
export type BatchSource =
  | { readonly kind: "version"; readonly version: number; readonly publishedBy: string | null }
  | {
      readonly kind: "draft";
      readonly draftRevision: number;
      /** Freezes the snapshot and consumes the draft inside the confirmation's transaction. */
      readonly freeze: (tx: Executor) => Promise<{ readonly version: number }>;
    };

/** The 200 body, stored verbatim so a replay answers exactly what the first attempt did. */
export interface BatchResult {
  version: number;
  releases: ReleaseBody[];
  replayed: boolean;
  /**
   * True when this confirmation froze the version it reports, false when it released one
   * that already existed. Stored with the result, because a client that lost its answer
   * cannot tell a frozen version from a released one apart from this.
   */
  froze: boolean;
}

interface ReleaseBody {
  formId: string;
  environment: string;
  version: number;
  sequence: number;
  fromEnvironment: string | null;
  releasedBy: string;
  releasedAt: string;
  approvedBy: string | null;
  replacedVersion: number | null;
  rollback: boolean;
  closed: boolean;
}

export interface CommitInput {
  readonly formId: FormId;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly idempotencyKey: string;
  readonly intentHash: string;
  readonly expectedWorkflowRevision: number | null;
  readonly source: BatchSource;
  readonly targets: readonly BatchTarget[];
}

const fail = {
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  staleReview: (field: string, environment?: string): ApiError =>
    new ApiError(
      "STALE_REVIEW",
      409,
      `The review this confirmation carries is out of date: ${field} has changed. Nothing ` +
        "was written; read the review again and confirm the new one.",
      { field, ...(environment === undefined ? {} : { environment }) },
    ),
  keyReused: (): ApiError =>
    new ApiError(
      "IDEMPOTENCY_KEY_REUSED",
      422,
      "This idempotency key was used for a different confirmation. Mint a new key for a " +
        "new act, or resend the original one to read its result.",
    ),
  duplicateTarget: (environment: string): ApiError =>
    new ApiError(
      "DUPLICATE_TARGET",
      400,
      `${environment} is named twice; one confirmation releases into each destination once`,
    ),
  alreadyReleased: (version: number, environment: string): ApiError =>
    new ApiError(
      "ALREADY_RELEASED",
      409,
      `Version ${version} is already the released version in ${environment}`,
    ),
  releaseRaced: (): ApiError =>
    new ApiError(
      "RELEASE_RACED",
      409,
      "Another release into one of these destinations landed first; read the history and " +
        "try again",
    ),
} as const;

function isReleaseKeyViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

/**
 * The stored result for a key already used, or `undefined`. A fast path for a confirmation
 * whose first attempt consumed the draft: without it a replay would freeze nothing and
 * report "no draft to publish" instead of the result it already produced. The same lookup
 * runs again under the form's lock, which is what decides a race.
 */
export async function storedResult(
  deps: Deps,
  input: {
    readonly principalId: string;
    readonly formId: FormId;
    readonly idempotencyKey: string;
    readonly intentHash: string;
  },
): Promise<BatchResult | undefined> {
  const stored = await getReleaseBatch(deps.databases.control, input);
  if (stored === undefined) return undefined;
  if (stored.intentHash !== input.intentHash) throw fail.keyReused();
  return { ...(stored.result as BatchResult), replayed: true };
}

/** Stable key order, so the same intent hashes the same whatever a client serialises first. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((member) => canonical(member));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "idempotencyKey")
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries.map(([key, member]) => [key, canonical(member)]));
}

/** sha256 of the canonical body with the key removed: the same act, or a different one. */
export async function intentHashOf(body: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(body)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newestIn(
  releases: readonly FormReleaseHistoryRow[],
  environment: string,
): FormReleaseHistoryRow | undefined {
  return releases.find((release) => release.environment === environment);
}

/**
 * One confirmation: one lock, every expectation rechecked, at most one snapshot, one
 * release row and one `form.released` event per destination, and the stored result. Any
 * refusal rolls the whole thing back, so a denied second destination leaves no version
 * behind and no event queued for the first.
 */
export async function commitReleaseBatch(deps: Deps, input: CommitInput): Promise<BatchResult> {
  const seen = new Set<string>();
  for (const target of input.targets) {
    if (seen.has(target.environment)) throw fail.duplicateTarget(target.environment);
    seen.add(target.environment);
  }

  try {
    return await deps.databases.control.transaction(async (tx) => {
      // One publish or release per form at a time. Taken before the replay lookup, so two
      // copies of one request cannot both find no stored result.
      const form = await lockForm(tx, input.formId);
      if (form === undefined) throw fail.formNotFound();

      const stored = await getReleaseBatch(tx, {
        principalId: input.principalId,
        formId: input.formId,
        idempotencyKey: input.idempotencyKey,
      });
      if (stored !== undefined) {
        if (stored.intentHash !== input.intentHash) throw fail.keyReused();
        return { ...(stored.result as BatchResult), replayed: true };
      }

      const workflow = await readWorkflow(tx, deps.databases.names);
      if ((workflow.revision ?? null) !== input.expectedWorkflowRevision) {
        throw fail.staleReview("workflowRevision");
      }

      if (input.source.kind === "draft") {
        const draft = await getDraft(tx, input.formId);
        if (draft?.revision !== input.source.draftRevision) {
          throw fail.staleReview("draftRevision");
        }
      }

      const releases = await listFormReleases(tx, input.formId);
      const version = input.source.kind === "version" ? input.source.version : undefined;

      // Every recheck runs before the first write, so nothing is written for a
      // confirmation one of whose destinations is refused.
      const approvals = await recheckTargets(tx, { ...input, workflow, releases, version });

      const frozen = input.source.kind === "draft" ? await input.source.freeze(tx) : undefined;
      const released = version ?? frozen!.version;
      const written = await writeReleases(tx, {
        formId: input.formId,
        principalId: input.principalId,
        targets: input.targets,
        releases,
        approvals,
        version: released,
      });

      const result: BatchResult = {
        version: released,
        releases: written,
        replayed: false,
        froze: input.source.kind === "draft",
      };
      await insertReleaseBatch(tx, {
        principalId: input.principalId,
        formId: input.formId,
        idempotencyKey: input.idempotencyKey,
        intentHash: input.intentHash,
        result,
        createdAt: deps.clock.now(),
      });
      return result;
    });
  } catch (error) {
    if (isReleaseKeyViolation(error)) throw fail.releaseRaced();
    throw error;
  }
}

/**
 * Every expectation the review showed, per destination, and the approval each one needs.
 * It writes nothing: a refusal here leaves the confirmation with no effect at all.
 */
async function recheckTargets(
  tx: Executor,
  input: {
    readonly formId: FormId;
    readonly workspaceId: string;
    readonly principalId: string;
    readonly source: BatchSource;
    readonly targets: readonly BatchTarget[];
    readonly workflow: EffectiveWorkflow;
    readonly releases: readonly FormReleaseHistoryRow[];
    readonly version: number | undefined;
  },
): Promise<Map<string, string | undefined>> {
  const { workflow, releases, version, targets } = input;
  const author = input.source.kind === "version" ? input.source.publishedBy : input.principalId;
  // The number `freeze` is about to assign, read only for a refusal message: naming the
  // previous one would point an operator at a version they never touched.
  const candidate = version ?? (await nextVersion(tx, input.formId));
  const approvals = new Map<string, string | undefined>();

  for (const target of targets) {
    const rule = ruleFor(workflow, target.environment);
    if (targets.length > 1 && !rule.allowsInBatch) throw batchNotAllowed(target.environment);
    const current = newestIn(releases, target.environment);
    if ((current?.sequence ?? null) !== target.expectedSequence) {
      throw fail.staleReview("sequence", target.environment);
    }
    if (version === undefined) requireDraftEligible(workflow, target.environment);
    else {
      if (current?.version === version) throw fail.alreadyReleased(version, target.environment);
      requirePrerequisite({ workflow, releases, environment: target.environment, version });
    }
    approvals.set(
      target.environment,
      await approvalForRelease(tx, {
        workspaceId: input.workspaceId,
        environment: target.environment,
        version: candidate,
        author,
        releasedBy: input.principalId,
      }),
    );
  }
  return approvals;
}

/** One release row and one `form.released` event per destination, in the order listed. */
async function writeReleases(
  tx: Executor,
  input: {
    readonly formId: FormId;
    readonly principalId: string;
    readonly targets: readonly BatchTarget[];
    readonly releases: readonly FormReleaseHistoryRow[];
    readonly approvals: ReadonlyMap<string, string | undefined>;
    readonly version: number;
  },
): Promise<ReleaseBody[]> {
  const written: ReleaseBody[] = [];
  for (const target of input.targets) {
    const current = newestIn(input.releases, target.environment);
    const row = await recordRelease(tx, {
      formId: input.formId,
      environment: target.environment,
      version: input.version,
      releasedBy: input.principalId,
      approvedBy: input.approvals.get(target.environment),
      fromEnvironment: target.fromEnvironment,
      // Releasing into a closed environment does not resume intake.
      closed:
        (await getFormEnvironmentState(tx, input.formId, target.environment))?.closed ?? false,
    });
    written.push({
      formId: row.formId,
      environment: row.environment,
      version: row.version,
      sequence: row.sequence,
      fromEnvironment: row.fromEnvironment,
      releasedBy: row.releasedBy,
      releasedAt: row.releasedAt.toISOString(),
      approvedBy: row.approvedBy,
      replacedVersion: current?.version ?? null,
      rollback: current !== undefined && current.version > row.version,
      closed: row.closed,
    });
  }
  return written;
}

/** The number the next freeze assigns. */
async function nextVersion(tx: Executor, formId: FormId): Promise<number> {
  return ((await getLatestPublishedVersion(tx, formId))?.version ?? 0) + 1;
}
