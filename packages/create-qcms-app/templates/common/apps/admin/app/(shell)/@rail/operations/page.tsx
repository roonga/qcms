import { OperationsFormsRail } from "@/components/ops/operations-forms-rail";
import { shownEnvironment } from "@/lib/environment";
import {
  operationsApiQuery,
  operationsInEnvironment,
  readOperationsListState,
} from "@/lib/ops/operations-forms";
import { resolvedEnvironment } from "@/lib/server/environments";
import { listOperationsForms } from "@/lib/server/operations";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

export default async function OperationsRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const read = readOperationsListState(await searchParams);
  const [access, resolved, workspaceId] = await Promise.all([
    shellAccess(session),
    resolvedEnvironment(session),
    currentWorkspaceId(session),
  ]);
  const environment = shownEnvironment(resolved);
  const state = environment === undefined ? read : operationsInEnvironment(read, environment);
  const result =
    environment === undefined
      ? undefined
      : await listOperationsForms(
          session,
          operationsApiQuery(state, environment, workspaceId),
        );

  return (
    <OperationsFormsRail
      state={state}
      forms={result?.status === "ok" ? result.page.forms : []}
      showQueues={navigableCapabilities(access).siteConfiguration}
    />
  );
}
