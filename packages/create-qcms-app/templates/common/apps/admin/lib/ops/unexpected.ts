import { t } from "../i18n/en.ts";

/** Transport and JSON parsing can reject without an ApiResult. Render fixed catalog copy only; thrown values may carry secrets or respondent content. */
export function unexpected(): string {
  return t("ops.error.unexpected");
}
