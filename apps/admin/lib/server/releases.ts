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

/** `POST /admin/forms/{id}/publish-and-release` - one intent, one act (finding 2). */
export async function publishAndRelease(
  session: AdminSession,
  formId: string,
  environment: string,
): Promise<ApiResult<{ version: number; publishedAt: string; environment: string }>> {
  return readResult(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/publish-and-release`, {
      method: "POST",
      body: { environment },
    }),
  );
}
