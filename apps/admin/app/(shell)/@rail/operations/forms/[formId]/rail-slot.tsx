import { OperationsFormRail } from "@/components/ops/operations-form-rail";
import { shownEnvironment } from "@/lib/environment";
import { heldFormContexts, type FormContext } from "@/lib/ops/form-contexts";
import { resolvedEnvironment } from "@/lib/server/environments";
import { getForm } from "@/lib/server/forms";
import { formCellsHeld } from "@/lib/server/operations";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The one body every Operations form slot renders. The form read may be refused: a caller
 * with `response: read` and no `form: read` still reaches that form's responses, so the
 * id stands in for the name rather than the rail disappearing.
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
  const [detail, resolved] = await Promise.all([
    getForm(session, formId),
    resolvedEnvironment(session),
  ]);
  const environment = shownEnvironment(resolved);
  const cells = environment === undefined ? [] : await formCellsHeld(session, formId, environment);
  return (
    <OperationsFormRail
      formId={formId}
      name={detail.ok ? detail.data.slug : formId}
      current={current}
      held={heldFormContexts(cells)}
    />
  );
}
