import { OperationsFormRail } from "@/components/ops/operations-form-rail";
import type { FormContext } from "@/lib/ops/form-contexts";
import { getForm } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The one body every Operations form slot renders.
 *
 * The form read is memoized per request and is allowed to be refused: a caller holding
 * `response: read` and no `form: read` reaches that form's responses, so a rail that
 * needed the form's name would be a rail that disappeared for the one caller whose only
 * screen it is. The id stands in for the name in that case.
 */
export async function OperationsFormRailSlot({
  params,
  current,
}: {
  readonly params: Promise<{ formId: string }>;
  readonly current: FormContext;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;
  const detail = await getForm(session, formId);
  return (
    <OperationsFormRail
      formId={formId}
      name={detail.ok ? detail.data.slug : formId}
      current={current}
    />
  );
}
