import type { MovePreview } from "../forms/move.ts";

import { adminApiFetch } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/** Who gains and who loses, and whether the move needs an approver, as the API decides it. */
export async function readMovePreview(
  session: AdminSession,
  formId: string,
  destinationWorkspaceId: string,
): Promise<ApiResult<MovePreview>> {
  return readResult<MovePreview>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/workspace/preview?workspaceId=${encodeURIComponent(destinationWorkspaceId)}`,
    ),
  );
}

export interface MoveOutcome {
  /** True where the API held the move for an approver rather than applying it. */
  readonly held: boolean;
  readonly workspaceId: string;
}

export async function moveFormToWorkspace(
  session: AdminSession,
  formId: string,
  destinationWorkspaceId: string,
): Promise<ApiResult<MoveOutcome>> {
  const response = await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/workspace`, {
    method: "POST",
    body: { workspaceId: destinationWorkspaceId },
  });
  const result = await readResult<Record<string, unknown>>(response);
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      held: result.held === true,
      workspaceId:
        typeof result.data["workspaceId"] === "string"
          ? result.data["workspaceId"]
          : destinationWorkspaceId,
    },
  };
}
