import { adminApiFetch } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/** Mark or unmark one workspace as the installation's shared question library. */
export async function setSharedWorkspace(
  session: AdminSession,
  workspaceId: string,
  shared: boolean,
  options: { readonly handOn?: boolean } = {},
): Promise<ApiResult<{ readonly workspaceId: string; readonly isShared: boolean }>> {
  const result = await readResult<{ workspace?: { workspaceId?: unknown; isShared?: unknown } }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/shared`, {
      method: "PUT",
      body: options.handOn === true ? { shared, handOn: true } : { shared },
    }),
  );
  if (!result.ok) return result;
  const workspace = result.data.workspace ?? {};
  return {
    ok: true,
    data: {
      workspaceId: typeof workspace.workspaceId === "string" ? workspace.workspaceId : workspaceId,
      isShared: workspace.isShared === true,
    },
  };
}
