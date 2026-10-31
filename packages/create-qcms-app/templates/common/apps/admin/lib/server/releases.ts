import {
  parseReleaseReview,
  type PublishDestination,
  type ReleaseReview,
} from "../forms/release-candidate.ts";
import { parseReleases, type ReleaseRecord } from "../forms/releases.ts";

import { adminApiFetch } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/**
 * The release screens' calls into the API's `/admin` group (ADR-40, task 065, R2).
 *
 * A proxy in the same shape as `forms.ts` and `links.ts`, and for the same reason: this app
 * holds credentials, not authority. It does not decide whether a version may be released,
 * does not derive which release was a rollback, and does not know what is released where.
 * All three are the API's, over the `control.form_releases` record.
 *
 * **The rollback reading arrives on the row.** `rollback` is computed by the API from the
 * release's own predecessor in that environment, so this app renders a fact rather than
 * comparing version numbers itself - which is what keeps the marking the same answer on
 * every screen that shows it (ADR-40, criterion 4).
 *
 * The row type and the two pure readings of a history are in `lib/forms/releases.ts`,
 * because the screens that take them are client components.
 */

/** `GET /admin/forms/{id}/releases` - the whole history, newest first, every environment. */
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

/**
 * `POST /admin/forms/{id}/releases` - release a published version, or promote it.
 *
 * `fromEnvironment` records the path and authorises nothing: there is no ordering
 * requirement, so a release straight to `prod` omits it (Q4). Releasing an earlier version
 * than the one currently out is a **rollback** and is this same call - there is no second
 * endpoint, because there is no second mechanism.
 */
export async function releaseVersion(
  session: AdminSession,
  formId: string,
  request: {
    readonly environment: string;
    readonly version: number;
    readonly fromEnvironment?: string;
  },
): Promise<ApiResult<ReleaseRecord>> {
  const result = await readResult<{ release?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/releases`, {
      method: "POST",
      body: request,
    }),
  );
  if (!result.ok) return result;
  const release = parseReleases([result.data.release])[0];
  if (release === undefined) return { ok: false, code: "internal", message: "", issues: [] };
  return { ok: true, data: release };
}

/**
 * `POST /admin/forms/{id}/release-review` - what releasing one source would do, per
 * destination the caller may release into (phase 2 of the environment plan).
 *
 * A read that writes nothing: no version, no release, no reservation. It is the wizard's
 * whole eligibility model, because every blocker it reports is one the confirmation would
 * raise, computed by the API from committed state.
 */
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

/** The recorded outcome of one confirmation, as the wizard renders it. */
export interface BatchOutcome {
  readonly version: number;
  readonly releases: readonly ReleaseRecord[];
  /** True when this is the stored result of an earlier attempt with the same key. */
  readonly replayed: boolean;
}

function readBatch(
  result: ApiResult<{ version?: unknown; releases?: unknown; replayed?: unknown }>,
): ApiResult<BatchOutcome> {
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
    },
  };
}

/** What one confirmation sends, whichever of the two routes carries it. */
interface BatchRequest {
  readonly idempotencyKey: string;
  readonly expectedWorkflowRevision: number | null;
  readonly targets: readonly PublishDestination[];
}

/**
 * `POST /admin/forms/{id}/release-batch` - one existing version into every named
 * destination, atomically.
 *
 * Not a loop over `POST /forms/{id}/releases`: the API authorises each destination on its
 * own, rechecks every expectation under one lock, and rolls the whole act back if any
 * destination is refused. A client-side loop would leave the first release standing after
 * the second was denied, which is the failure the plan's invariant names.
 */
export async function releaseBatch(
  session: AdminSession,
  formId: string,
  request: BatchRequest & { readonly version: number },
): Promise<ApiResult<BatchOutcome>> {
  return readBatch(
    await readResult(
      await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/release-batch`, {
        method: "POST",
        body: {
          idempotencyKey: request.idempotencyKey,
          expectedWorkflowRevision: request.expectedWorkflowRevision,
          source: { kind: "version", version: request.version },
          targets: request.targets,
        },
      }),
    ),
  );
}

/**
 * `POST /admin/forms/{id}/publish-batch` - freeze the draft once and release that snapshot
 * into every named destination.
 *
 * An empty `targets` is "create a version without releasing it", which `form: publish`
 * alone authorises. That is the only route to a first version on a production-only
 * deployment with the second-person rule on, because the releasing account must differ
 * from the publisher (ADR-41).
 */
export async function publishBatch(
  session: AdminSession,
  formId: string,
  request: BatchRequest & { readonly draftRevision: number },
): Promise<ApiResult<BatchOutcome>> {
  return readBatch(
    await readResult(
      await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/publish-batch`, {
        method: "POST",
        body: {
          idempotencyKey: request.idempotencyKey,
          expectedWorkflowRevision: request.expectedWorkflowRevision,
          source: { kind: "draft", draftRevision: request.draftRevision },
          targets: request.targets,
        },
      }),
    ),
  );
}

/**
 * `GET /admin/forms/{id}/release-batches/{key}` - the stored result of one confirmation.
 *
 * What an uncertain response resolves into. A 404 means the confirmation never committed,
 * so the same key may be resent; it never means a new version should be created.
 */
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
