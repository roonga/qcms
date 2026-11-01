import Link from "next/link";

import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import {
  FORM_OPERATIONAL_CONTEXTS,
  formContextHref,
  type FormContext,
} from "@/lib/ops/form-contexts";
import { OPERATIONS_PATH } from "@/lib/shell/modes";

/**
 * The rail beside one form's operational screens (Code Owner, 2026-11-02).
 *
 * Its rows are the operational contexts alone: a form's authoring screens are the editor's
 * and are not reachable from here, because this mode's reads are one environment's and
 * authoring edits a shared draft.
 *
 * Navigation beside a page rather than authority, as the form editor's rail is: a row the
 * caller holds no cell for leads to that screen's own refusal. What is narrowed by the
 * caller's cells is the Operations table, which is where a form is chosen.
 */
export function OperationsFormRail({
  formId,
  name,
  current,
}: {
  readonly formId: string;
  /** The form's name when this caller may read it, else its id. */
  readonly name: string;
  readonly current: FormContext;
}) {
  return (
    <RailFrame
      subject={name}
      back={{ href: OPERATIONS_PATH, label: t("shell.mode.operations.name") }}
      title={name}
      testId="qcms-operations-form-rail"
      sections={
        <ul className="qcms-rail__group" data-rail-group="sections">
          {FORM_OPERATIONAL_CONTEXTS.map((context) => (
            <li key={context}>
              <Link
                href={formContextHref(formId, context)}
                className="qcms-rail__link"
                data-rail-item={`section:${context}`}
                {...(context === current ? { "aria-current": "page" as const } : {})}
              >
                {t(`forms.tab.${context}`)}
              </Link>
            </li>
          ))}
        </ul>
      }
    />
  );
}
