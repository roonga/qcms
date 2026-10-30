import { OperationsFormsRail } from "@/components/ops/operations-forms-rail";
import { shownEnvironment } from "@/lib/environment";
import { operationsApiQuery, readOperationsListState } from "@/lib/ops/operations-forms";
import { resolvedEnvironment } from "@/lib/server/environments";
import { listOperationsForms } from "@/lib/server/operations";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";

/**
 * Operations' rail. The discovery read is memoized per request, so the workspace options
 * ride the page's round trip rather than asking a second time.
 */
export default async function OperationsRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const state = readOperationsListState(await searchParams);
  const [access, resolved] = await Promise.all([
    shellAccess(session),
    resolvedEnvironment(session),
  ]);
  const environment = state.environment ?? shownEnvironment(resolved);
  const result =
    environment === undefined
      ? undefined
      : await listOperationsForms(session, operationsApiQuery(state, environment));

  return (
    <OperationsFormsRail
      state={state}
      workspaces={result?.status === "ok" ? result.page.workspaces : []}
      showQueues={navigableCapabilities(access).siteConfiguration}
    />
  );
}
