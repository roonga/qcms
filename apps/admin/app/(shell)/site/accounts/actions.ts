"use server";

import { revalidatePath } from "next/cache";

import { t } from "@/lib/i18n/en";
import {
  createAccount,
  disableAccount,
  reactivateAccount,
  resendSignInLink,
  resetAccount,
  stepUp,
  type ActOutcome,
} from "@/lib/server/accounts";
import type { ApiResult } from "@/lib/server/api-result";
import { requireAdminSession, type AdminSession } from "@/lib/server/session";
import {
  ACCOUNTS_PATH,
  accountErrorMessage,
  createAccountErrorMessage,
  accountHref,
  type AccountActState,
  type CreateAccountState,
  type ResetChoice,
} from "@/lib/site/accounts";

/* The API authorizes every act; a hidden or disabled control here is never the boundary. */

export interface StepUpCredentials {
  readonly password: string;
  readonly code: string;
}

function refresh(userId: string): void {
  revalidatePath(ACCOUNTS_PATH);
  revalidatePath(accountHref(userId));
}

function refused(code: string): AccountActState {
  return { status: "error", code, message: accountErrorMessage(code) };
}

async function steppedUp(
  session: AdminSession,
  credentials: StepUpCredentials | undefined,
): Promise<AccountActState | undefined> {
  if (credentials === undefined) return undefined;
  const result = await stepUp(session, credentials);
  return result.ok ? undefined : refused(result.code);
}

function settled(userId: string, result: ApiResult<ActOutcome>, done: string): AccountActState {
  if (!result.ok) return refused(result.code);
  refresh(userId);
  if (result.data.held) return { status: "held", message: t("site.accounts.act.held") };
  if (result.data.delivery === "undeliverable") {
    return {
      status: "error",
      code: "UNDELIVERABLE",
      message: t("site.accounts.act.undeliverable"),
    };
  }
  return { status: "done", message: done };
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function createAccountAction(
  _state: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const session = await requireAdminSession();
  const email = field(formData, "email");
  const name = field(formData, "name");
  const result = await createAccount(session, { email, ...(name === "" ? {} : { name }) });
  if (!result.ok) {
    return {
      status: "error",
      code: result.code,
      message: createAccountErrorMessage(result.code),
      submitted: { email, name },
    };
  }
  revalidatePath(ACCOUNTS_PATH);
  const { account } = result.data;
  return {
    status: result.data.delivery,
    userId: account.userId,
    email: account.email,
    name: account.name,
  };
}

export async function resendSignInLinkAction(userId: string): Promise<AccountActState> {
  const session = await requireAdminSession();
  const result = await resendSignInLink(session, userId);
  if (!result.ok) return refused(result.code);
  refresh(userId);
  return result.data === "sent"
    ? { status: "done", message: t("site.accounts.resend.done") }
    : { status: "error", code: "UNDELIVERABLE", message: t("site.accounts.act.undeliverable") };
}

export async function disableAccountAction(
  userId: string,
  credentials?: StepUpCredentials,
): Promise<AccountActState> {
  const session = await requireAdminSession();
  const stepUpRefusal = await steppedUp(session, credentials);
  if (stepUpRefusal !== undefined) return stepUpRefusal;
  return settled(userId, await disableAccount(session, userId), t("site.accounts.disable.done"));
}

export async function reactivateAccountAction(userId: string): Promise<AccountActState> {
  const session = await requireAdminSession();
  return settled(
    userId,
    await reactivateAccount(session, userId),
    t("site.accounts.reactivate.done"),
  );
}

export async function resetAccountAction(
  userId: string,
  choice: ResetChoice,
  credentials?: StepUpCredentials,
): Promise<AccountActState> {
  const session = await requireAdminSession();
  const stepUpRefusal = await steppedUp(session, credentials);
  if (stepUpRefusal !== undefined) return stepUpRefusal;
  return settled(
    userId,
    await resetAccount(session, userId, choice === "factor" ? "factor" : "password"),
    choice === "factor"
      ? t("site.accounts.reset.doneFactor")
      : t("site.accounts.reset.donePassword"),
  );
}
