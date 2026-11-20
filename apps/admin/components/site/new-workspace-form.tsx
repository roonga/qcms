"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert, Button, TextField } from "@/components/kit";
import { useAppLocale } from "@/components/locale-context";
import { useIsHydrated } from "@/lib/hydrated";
import { t } from "@/lib/i18n/en";
import { workspaceSectionHref } from "@/lib/membership/sections";
import {
  IDLE_CREATE_WORKSPACE,
  starterEnvironments,
  starterRoles,
  WORKSPACE_NAME_MAX_LENGTH,
  type CreateWorkspaceState,
} from "@/lib/site/workspaces";

/** After a create: the four starter groups it opened with, and what to do next. */
function CreatedPanel({ state }: { readonly state: Extract<CreateWorkspaceState, { status: "created" }> }) {
  const locale = useAppLocale();
  return (
    <section
      aria-labelledby="qcms-workspace-created-heading"
      className="flex min-w-0 flex-col gap-4"
      data-testid="qcms-workspace-created"
    >
      <Alert variant="success">{t("site.workspaces.created", { name: state.name })}</Alert>
      <h2 id="qcms-workspace-created-heading" className="text-lg font-semibold text-(--color-text)">
        {t("site.workspaces.starter.heading")}
      </h2>
      <p className="text-sm">{t("site.workspaces.starter.intro")}</p>
      {state.groups === undefined ? (
        <Alert variant="error">{t("site.workspaces.starter.loadFailed")}</Alert>
      ) : (
        <div className="qcms-table">
          <table data-testid="qcms-starter-groups">
            <caption className="qcms-visually-hidden">{t("site.workspaces.starter.heading")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("site.workspaces.starter.group")}</th>
                <th scope="col">{t("site.workspaces.starter.roles")}</th>
                <th scope="col">{t("site.workspaces.starter.environments")}</th>
              </tr>
            </thead>
            <tbody>
              {state.groups.map((group) => (
                <tr key={group.name}>
                  <th scope="row">{group.name}</th>
                  <td>{starterRoles(group, locale)}</td>
                  <td>{starterEnvironments(group, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="text-base font-semibold text-(--color-text)">
        {t("site.workspaces.checklist.heading")}
      </h3>
      <ol className="flex list-decimal flex-col gap-2 pl-6 text-sm" data-testid="qcms-workspace-checklist">
        <li>
          <Link className="qcms-text-link" href={workspaceSectionHref(state.workspaceId, "members")}>
            {t("site.workspaces.checklist.members")}
          </Link>
        </li>
        <li>
          <Link
            className="qcms-text-link"
            href={workspaceSectionHref(state.workspaceId, "access-groups")}
          >
            {t("site.workspaces.checklist.groups")}
          </Link>
        </li>
        <li>
          <Link className="qcms-text-link" href={workspaceSectionHref(state.workspaceId, "settings")}>
            {t("site.workspaces.checklist.settings")}
          </Link>
        </li>
      </ol>
    </section>
  );
}

export function NewWorkspaceForm({
  create,
  viewerEmail,
}: {
  readonly create: (
    state: CreateWorkspaceState,
    formData: FormData,
  ) => Promise<CreateWorkspaceState>;
  /** The first Workspace administrator defaults to the Site administrator creating it. */
  readonly viewerEmail: string;
}) {
  const [state, formAction, isPending] = useActionState(create, IDLE_CREATE_WORKSPACE);
  const isHydrated = useIsHydrated();
  const submitted =
    state.status === "error" ? state.submitted : { name: "", firstAdministrator: viewerEmail };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      <form
        key={state.status === "error" ? `${submitted.name}|${submitted.firstAdministrator}` : state.status === "created" ? state.workspaceId : "fresh"}
        action={formAction}
        className="flex max-w-xl flex-col gap-4"
      >
        <TextField
          name="name"
          label={t("site.workspaces.name")}
          defaultValue={submitted.name}
          autoComplete="off"
          isRequired
          maxLength={WORKSPACE_NAME_MAX_LENGTH}
        />
        <TextField
          name="firstAdministrator"
          type="email"
          label={t("site.workspaces.firstAdministrator")}
          description={t("site.workspaces.firstAdministratorHint")}
          defaultValue={submitted.firstAdministrator}
          autoComplete="off"
          maxLength={254}
        />
        <p className="text-sm text-(--color-text-muted)">{t("site.workspaces.note")}</p>
        <div>
          <Button type="submit" variant="primary" size="md" isDisabled={isPending || !isHydrated}>
            {isPending ? t("site.workspaces.working") : t("site.workspaces.create")}
          </Button>
        </div>
      </form>
      {state.status === "created" && <CreatedPanel state={state} />}
    </div>
  );
}
