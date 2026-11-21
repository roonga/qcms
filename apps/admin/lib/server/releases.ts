import {
  parseReleaseReview,
  type PublishDestination,
  type ReleaseReview,
} from "../forms/release-candidate.ts";
import { parseHeldPublishes, type HeldPublishRequest } from "../forms/held-publish.ts";
import { parseReleases, type ReleaseRecord } from "../forms/releases.ts";
import { t } from "../i18n/en.ts";

import { proposalHeaders, type AgentProposalRef } from "./agent-proposal.ts";
import { adminApiFetch } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/** Render rollback facts from the API row, never infer them by comparing version numbers in the BFF. */

export async function listReleases(
  session: AdminSession,
  formId: string,
): Promise<ApiResult<readonly ReleaseRecord[]>> {
  const result = await readResult<{ releases?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/releases`),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseReleases(result.data.releases) };
}

/** fromEnvironment records provenance without granting authority or imposing order. Rolling back uses the same release endpoint. */
export async function releaseVersion(
  session: AdminSession,
  formId: string,
  request: {
    readonly environment: string;
    readonly version: number;
    readonly fromEnvironment?: string;
  },
  proposal?: AgentProposalRef,
): Promise<ApiResult<ReleaseRecord>> {
  const result = await readResult<{ release?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/releases`, {
      method: "POST",
      body: request,
      headers: proposalHeaders(proposal),
    }),
  );
  if (!result.ok) return result;
  const release = parseReleases([result.data.release])[0];
  if (release === undefined) return { ok: false, code: "internal", message: "", issues: [] };
  return { ok: true, data: release };
}

/** Review writes no version, release or reservation; eligibility is recomputed from committed API state. */
export async function reviewRelease(
  session: AdminSession,
  formId: string,
  source: { readonly kind: "draft" } | { readonly kind: "version"; readonly version: number },
): Promise<ApiResult<ReleaseReview>> {
  const result = await readResult<unknown>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/release-review`, {
      method: "POST",
      body: { source },
    }),
  );
  if (!result.ok) return result;
  const review = parseReleaseReview(result.data);
  if (review === undefined) return { ok: false, code: "internal", message: "", issues: [] };
  return { ok: true, data: review };
}

/** A 202 from the batch route: the publish is a request, and nothing was frozen. */
export interface HeldPublish {
  readonly held: true;
}

export interface BatchOutcome {
  readonly version: number;
  readonly releases: readonly ReleaseRecord[];

  readonly replayed: boolean;

  readonly froze: boolean;
}

type BatchBody = ApiResult<{
  version?: unknown;
  releases?: unknown;
  replayed?: unknown;
  froze?: unknown;
}>;

/* A held publish carries a request and no version, so it is read before the version is. */
function readBatchOrHeld(result: BatchBody): ApiResult<BatchOutcome | HeldPublish> {
  if (result.ok && result.held === true) return { ok: true, data: { held: true } };
  return readBatch(result);
}

function readBatch(result: BatchBody): ApiResult<BatchOutcome> {
  if (!result.ok) return result;
  if (typeof result.data.version !== "number") {
    return { ok: false, code: "internal", message: "", issues: [] };
  }
  return {
    ok: true,
    data: {
      version: result.data.version,
      releases: parseReleases(result.data.releases),
      replayed: result.data.replayed === true,
      froze: result.data.froze === true,
    },
  };
}

interface BatchRequest {
  readonly idempotencyKey: string;
  readonly expectedWorkflowRevision: number | null;
  readonly targets: readonly PublishDestination[];
}

/** Use the atomic batch endpoint: a client loop could leave earlier destinations released after a later refusal. */
export async function releaseBatch(
  session: AdminSession,
  formId: string,
  request: BatchRequest & { readonly version: number },
  proposal?: AgentProposalRef,
): Promise<ApiResult<BatchOutcome | HeldPublish>> {
  return readBatchOrHeld(
    await readResult(
      await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/release-batch`, {
        method: "POST",
        body: {
          idempotencyKey: request.idempotencyKey,
          expectedWorkflowRevision: request.expectedWorkflowRevision,
          source: { kind: "version", version: request.version },
          targets: request.targets,
        },
        headers: proposalHeaders(proposal),
      }),
    ),
  );
}

/** The route accepts no destination, which freezes alone; the wizard always names at least one. */
export async function publishBatch(
  session: AdminSession,
  formId: string,
  request: BatchRequest & { readonly draftRevision: number },
  proposal?: AgentProposalRef,
): Promise<ApiResult<BatchOutcome | HeldPublish>> {
  const result = readBatchOrHeld(
    await readResult(
      await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/publish-batch`, {
        method: "POST",
        body: {
          idempotencyKey: request.idempotencyKey,
          expectedWorkflowRevision: request.expectedWorkflowRevision,
          source: { kind: "draft", draftRevision: request.draftRevision },
          targets: request.targets,
        },
        headers: proposalHeaders(proposal),
      }),
    ),
  );
  // Only a draft reaches this route, so the catalog's frozen-version refusal is false here.
  if (!result.ok && result.code === "APPROVER_IS_AUTHOR") {
    return { ...result, message: t("forms.publish.blocked.draftSecondApproval") };
  }
  return result;
}

const PROD = "prod";

/** The form's held draft publishes to `prod`, newest first. */
export async function listHeldPublishes(
  session: AdminSession,
  formId: string,
): Promise<ApiResult<readonly HeldPublishRequest[]>> {
  const result = await readResult<unknown>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/publish-requests`),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseHeldPublishes(result.data) };
}

/** Approve or reject a held draft publish; both are decided under `prod` only. */
export async function decideHeldPublish(
  session: AdminSession,
  formId: string,
  requestId: string,
  decision: "approve" | "reject",
): Promise<ApiResult<unknown>> {
  return readResult<unknown>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/publish-requests/${encodeURIComponent(requestId)}/${decision}?environment=${PROD}`,
      { method: "POST", environment: PROD },
    ),
  );
}

/** A 404 means this key never committed and may be resent; it never calls for creating another version. */
export async function lookupReleaseBatch(
  session: AdminSession,
  formId: string,
  key: string,
): Promise<ApiResult<BatchOutcome>> {
  return readBatch(
    await readResult(
      await adminApiFetch(
        session,
        `/forms/${encodeURIComponent(formId)}/release-batches/${encodeURIComponent(key)}`,
      ),
    ),
  );
}
