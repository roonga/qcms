import { t } from "@/lib/i18n/en";
import type { QuestionStatus } from "@/lib/questions/types";

export function StatusTag({ status }: { readonly status: QuestionStatus }) {
  return (
    <span className={`qcms-tag qcms-tag--${status}`} data-status={status}>
      {t(`questions.status.${status}`)}
    </span>
  );
}
