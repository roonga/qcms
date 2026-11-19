"use server";

import { revalidatePath } from "next/cache";

import { t } from "@/lib/i18n/en";
import { moveFormToWorkspace } from "@/lib/server/move-form";
import { requireAdminSession } from "@/lib/server/session";

export type MoveState =
  | { readonly status: "idle" }
  | { readonly status: "moved"; readonly message: string }
  | { readonly status: "held"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

/* The API decides whether the move applies or waits for an approver; this reports which. */
export async function moveFormAction(
  formId: string,
  destination: { readonly workspaceId: string; readonly name: string },
): Promise<MoveState> {
  const session = await requireAdminSession();
  const result = await moveFormToWorkspace(session, formId, destination.workspaceId);
  if (!result.ok) {
    return { status: "error", message: t("forms.move.failed", { message: result.message }) };
  }
  revalidatePath(`/forms/${formId}/move`);
  revalidatePath("/forms");
  return result.data.held
    ? { status: "held", message: t("forms.move.held") }
    : { status: "moved", message: t("forms.move.moved", { destination: destination.name }) };
}
