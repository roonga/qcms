import type { Metadata } from "next";

import { t } from "./i18n/en.ts";

/** Build metadata from route IDs without a second upstream read. Failed entity reads still need an identifying tab title. */

export type FormSection =
  "builder" | "rules" | "preview" | "versions" | "publish" | "links" | "responses" | "webhooks";

export function pageMetadata(page: string): Metadata {
  return { title: t("app.pageTitle", { page }) };
}

/** Use the same section catalog key as heading, breadcrumb and rail so one destination cannot acquire multiple names. */
export function formSectionName(section: FormSection, formId: string): string {
  return t("title.formSection", { section: t(`forms.tab.${section}`), formId });
}
