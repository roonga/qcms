import Link from "next/link";
import type { Metadata } from "next";

import { HeadingMarker } from "@/components/agent/heading-marker";
import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/kit";
import { UnavailableAction } from "@/components/forms/unavailable-action";
import { holdsEditForms } from "@/lib/forms/build-access";
import { readFormListFilters } from "@/lib/forms/list-filters";
import { formsListStates } from "@/lib/forms/role-states";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { optionalProp } from "@/lib/questions/errors";
import { agentAuthoringEnabled } from "@/lib/server/agent";
import { listForms } from "@/lib/server/forms";
import { readMyAccess } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { currentWorkspaceId } from "@/lib/server/workspace-context";
import { permitsMode } from "@/lib/shell/modes";

import { FormsTable } from "./forms-table";

export function generateMetadata(): Metadata {
  return pageMetadata(t("forms.title"));
}

export default async function FormsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { status, sort, search, isFiltered } = readFormListFilters(await searchParams);

  const builder = agentAuthoringEnabled();
  const workspaceId = await currentWorkspaceId(session);
  const [result, capabilities, access] = await Promise.all([
    listForms(session, {
      ...optionalProp("status", status),
      ...optionalProp("workspaceId", workspaceId),
      search,
      sort,
    }),
    shellAccess(session).then(navigableCapabilities),
    readMyAccess(session),
  ]);
  const accessRecord = access.ok ? access.data : undefined;
  const states = formsListStates(accessRecord, workspaceId);

  const isEmpty = result.ok && result.data.length === 0;
  const createControl =
    states.createReason === undefined ? (
      <Link href="/forms/new" className="qcms-button-link">
        {t("forms.new")}
      </Link>
    ) : (
      <UnavailableAction label={t("forms.new")} reason={states.createReason} testId="qcms-forms-create" />
    );
  const readOnlyRows = result.ok && result.data.some((form) => states.readOnly(form.workspaceId));

  return (
    <div className="flex flex-col gap-6">
      <div className="qcms-page-actionbar">
        <h1 className="sr-only">{t("forms.title")}</h1>
        {!(isEmpty && !isFiltered) && (
          <HeadingMarker control="forms.create">{createControl}</HeadingMarker>
        )}
      </div>

      {!result.ok && (
        <Alert variant="error">{t("forms.error.listFailed", { message: result.message })}</Alert>
      )}

      {isEmpty &&
        (isFiltered ? (
          <EmptyState
            heading={t("forms.empty.filtered")}
            testId="qcms-forms-empty"
            action={
              <Link href="/forms" className="qcms-button-link">
                {t("forms.filter.clear")}
              </Link>
            }
          />
        ) : states.noAccessWorkspace === undefined ? (
          <EmptyState
            heading={t("forms.empty.title")}
            body={t("forms.empty.body")}
            testId="qcms-forms-empty"
            action={createControl}
          />
        ) : (
          <EmptyState
            heading={t("forms.empty.noAccess", { workspace: states.noAccessWorkspace })}
            body={t("forms.empty.noAccessBody")}
            testId="qcms-forms-empty"
          />
        ))}

      {readOnlyRows && (
        <p className="text-sm" data-testid="qcms-forms-read-only">
          {states.readOnlyReason}
        </p>
      )}

      {result.ok && result.data.length > 0 && (
        <FormsTable
          rows={result.data}
          canOperate={permitsMode(capabilities, "operations")}
          canBuild={(form) => builder && holdsEditForms(accessRecord, form.workspaceId)}
          readOnly={(form) => states.readOnly(form.workspaceId)}
        />
      )}
    </div>
  );
}
