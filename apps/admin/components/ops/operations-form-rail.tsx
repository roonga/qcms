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
 * The rail beside one form's operational screens: the operational contexts this caller
 * holds, because this mode reads one environment and authoring edits a shared draft. The
 * rule is the Operations row's own, so a response viewer arriving from a row meets the
 * same one context there and here.
 */
export function OperationsFormRail({
  formId,
  name,
  current,
  held,
}: {
  readonly formId: string;
  /** The form's name when this caller may read it, else its id. */
  readonly name: string;
  readonly current: FormContext;
  /** The contexts this caller's cells admit. The screen being served is drawn whatever it says. */
  readonly held: readonly FormContext[];
}) {
  const rows = FORM_OPERATIONAL_CONTEXTS.filter(
    (context) => context === current || held.includes(context),
  );
  return (
    <RailFrame
      subject={name}
      back={{ href: OPERATIONS_PATH, label: t("shell.mode.operations.name") }}
      title={name}
      testId="qcms-operations-form-rail"
      sections={
        <ul className="qcms-rail__group" data-rail-group="sections">
          {rows.map((context) => (
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
