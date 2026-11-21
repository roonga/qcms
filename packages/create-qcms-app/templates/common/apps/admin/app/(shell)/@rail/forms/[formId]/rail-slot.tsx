import { FormSubtreeRail } from "@/components/forms/form-subtree-rail";
import { RailAddStep } from "@/components/forms/rail-add-step";
import { RailSteps } from "@/components/forms/rail-steps";
import type { RailCurrent, RailItem } from "@/lib/forms/subtree-rail";
import { moveDestinations } from "@/lib/forms/move";
import { loadFormRail } from "@/lib/server/form-rail";
import { readMyAccess } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

/* The rail always navigates the form's draft steps; version and response detail routes mark their parent
   section. */
export async function FormRailSlot({
  params,
  current,
}: {
  readonly params: Promise<{ formId: string }>;
  readonly current: RailCurrent;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;
  const rail = await loadFormRail(session, formId);
  if (rail === null) return null;
  const access = await readMyAccess(session);
  const offersMove =
    access.ok && moveDestinations(access.data.workspaces, rail.workspaceId).length > 0;

  return (
    <FormSubtreeRail
      formId={rail.formId}
      slug={rail.slug}
      title={rail.title}
      status={rail.status}
      steps={rail.steps}
      issueCounts={rail.issueCounts}
      current={current}
      offersMove={offersMove}
      renderSteps={(item: RailItem, steps: readonly RailItem[]) => (
        <RailSteps item={item} serverItems={steps} />
      )}
      actions={<RailAddStep builderHref={`/forms/${encodeURIComponent(rail.formId)}`} />}
    />
  );
}
