import type { Metadata } from "next";

import { NewAccountForm } from "@/components/site/new-account-form";
import { loadSiteScreen } from "@/components/site/site-screen";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";

import { createAccountAction, resendSignInLinkAction } from "../actions";

export function generateMetadata(): Metadata {
  return pageMetadata(t("site.accounts.new"));
}

export default async function NewAccountPage() {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return screen.element;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <h1 className="text-xl font-semibold text-(--color-text)">{t("site.accounts.new")}</h1>
      <NewAccountForm create={createAccountAction} resend={resendSignInLinkAction} />
    </div>
  );
}
