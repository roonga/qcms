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

/* One API call: marking hands the library on, so no failure leaves it half moved. */
export async function setSharedLibraryAction(next: SharedLibraryChoice): Promise<LibraryState> {
  const session = await requireAdminSession();
  let result: Awaited<ReturnType<typeof setSharedWorkspace>> | undefined;
  if (next.workspaceId !== null) {
    result = await setSharedWorkspace(session, next.workspaceId, true, { handOn: true });
  } else if (next.holder !== null) {
    result = await setSharedWorkspace(session, next.holder, false);
  }
  if (result !== undefined && !result.ok) {
    return { status: "error", message: t("site.library.failed", { message: result.message }) };
  }
  revalidatePath(SHARED_LIBRARY_PATH);
  revalidatePath("/questions");
  return { status: "done", message: t("site.library.saved") };
}
