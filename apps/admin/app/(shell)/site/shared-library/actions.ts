"use server";

import { revalidatePath } from "next/cache";

import { t } from "@/lib/i18n/en";
import { SHARED_LIBRARY_PATH } from "@/lib/membership/site";
import { setSharedWorkspace } from "@/lib/server/site";
import { requireAdminSession } from "@/lib/server/session";

export type LibraryState =
  | { readonly status: "idle" }
  | { readonly status: "done"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

/** The workspace to hold the library, or `null` for none, and the one holding it now. */
export interface SharedLibraryChoice {
  readonly workspaceId: string | null;
  readonly holder: string | null;
}

/* Marking one workspace unmarks the one that held the library, so the two writes are one act. */
export async function setSharedLibraryAction(next: SharedLibraryChoice): Promise<LibraryState> {
  const session = await requireAdminSession();
  if (next.holder !== null && next.holder !== next.workspaceId) {
    const cleared = await setSharedWorkspace(session, next.holder, false);
    if (!cleared.ok) {
      return { status: "error", message: t("site.library.failed", { message: cleared.message }) };
    }
  }
  if (next.workspaceId !== null) {
    const marked = await setSharedWorkspace(session, next.workspaceId, true);
    if (!marked.ok) {
      return { status: "error", message: t("site.library.failed", { message: marked.message }) };
    }
  }
  revalidatePath(SHARED_LIBRARY_PATH);
  revalidatePath("/questions");
  return { status: "done", message: t("site.library.saved") };
}
