import { canonicalJson, type FormId } from "@roonga/qcms-core";
import { getDraft, insertApprovalRequest, type FormDraftRow } from "@roonga/qcms-db";

import { openDbHandle } from "./admin-accounts.js";

/**
 * Store a held draft publish to `prod` for a form's stored draft, as the API does on a site
 * whose only environment is `prod`. The harness serves `test` beside `prod`, where the API
 * never holds one, so the browser specs reach the held states through this row. The content
 * hash is the API's `draftContentHash`: the whole draft row but its save time.
 */
export async function holdDraftPublishForTest(
  databaseUrl: string,
  input: { readonly formId: string; readonly workspaceId: string; readonly requestedBy: string },
): Promise<string> {
  const handle = openDbHandle(databaseUrl);
  try {
    const draft = await getDraft(handle.db, input.formId as FormId);
    if (draft === undefined)
      throw new Error(`holdDraftPublishForTest: ${input.formId} has no draft`);
    const content: Partial<FormDraftRow> = { ...draft };
    delete content.updatedAt;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalJson(content)),
    );
    const contentHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const row = await insertApprovalRequest(handle.db, {
      kind: "draft-publish",
      workspaceId: input.workspaceId,
      target: input.formId,
      payload: { revision: draft.revision, contentHash },
      requestedBy: input.requestedBy,
      requestedAt: new Date(),
    });
    if (row === undefined) throw new Error("holdDraftPublishForTest: no request was stored");
    return row.requestId;
  } finally {
    await handle.close();
  }
}
