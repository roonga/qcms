import { Alert } from "@/components/kit";
import { FormPageHeader } from "@/components/forms/form-page-header";
import { FormActions } from "@/components/forms/form-actions";
import { ReleasePanel } from "@/components/forms/release-panel";
import { VersionView } from "@/components/forms/version-view";
import { SwitchToTest } from "@/components/forms/switch-to-test";
import type { FormDetail } from "@/lib/forms/types";
import { VERSION_HEADING_ID } from "@/lib/page-headings";
import { t } from "@/lib/i18n/en";
import { getFormVersion } from "@/lib/server/forms";
import { listReleases } from "@/lib/server/releases";
import { requireAdminSession } from "@/lib/server/session";
import { previewPortalTheme, secureCookies } from "@/lib/server/config";
import {
  releaseVersionAction,
  reviewFormVersionAction,
  publishFormAction,
  publishAndReleaseAction,
  setFormStatusAction,
} from "@/app/(shell)/forms/actions";

/** Production reads immutable content; it never renders the shared draft builder. */
export async function FormProductionReview({
  form,
  environments,
}: {
  readonly form: FormDetail;
  readonly environments: readonly string[];
}) {
  const session = await requireAdminSession();
  const workflow = form.workflow;
  const environment = workflow?.environment ?? "";
  const history = await listReleases(session, form.formId);
  const version = workflow?.currentVersion;
  const snapshot =
    version == null ? undefined : await getFormVersion(session, form.formId, version);
  return (
    <div className="flex flex-col gap-6" data-testid="qcms-published-form-review">
      <FormPageHeader
        formId={form.formId}
        section="builder"
        status={form.status}
        heading={{ id: "qcms-published-form-heading", text: t("forms.workflow.publishedForm") }}
      />
      <Alert variant="info">
        {t(
          environment === "prod" ? "forms.workflow.editInTest" : "forms.workflow.noEditPermission",
        )}
      </Alert>
      {environment === "prod" && environments.includes("test") && (
        <SwitchToTest secure={secureCookies()} />
      )}
      <FormActions
        lifecycleOnly
        workflow={workflow}
        formId={form.formId}
        slug={form.slug}
        status={form.status}
        draft={null}
        latestVersion={form.versions[0]?.version}
        environment={environment}
        publish={publishFormAction.bind(null, form.formId)}
        publishAndRelease={publishAndReleaseAction.bind(null, form.formId, environment)}
        setStatus={setFormStatusAction.bind(null, form.formId, environment)}
      />
      {!history.ok ? (
        <Alert variant="error">{history.message}</Alert>
      ) : (
        <ReleasePanel
          formId={form.formId}
          releases={history.data}
          versions={form.versions.map((v) => v.version)}
          environments={environments}
          selectedEnvironment={environment}
          workflow={workflow}
          reviewVersion={reviewFormVersionAction.bind(null, form.formId, environment)}
          defaultTheme={previewPortalTheme()}
          release={releaseVersionAction.bind(null, form.formId, environment)}
          twoPerson={{
            required: form.requiresSecondApprover,
            viewer: session.userId,
            authorOf: Object.fromEntries(
              form.versions.map((v) => [String(v.version), v.publishedBy]),
            ),
          }}
        />
      )}
      {snapshot === undefined && <p>{t("forms.workflow.noReleasedVersion")}</p>}
      {snapshot !== undefined && !snapshot.ok && <Alert variant="error">{snapshot.message}</Alert>}
      {snapshot?.ok && (
        <>
          <h2 id={VERSION_HEADING_ID}>
            {t("forms.workflow.reviewCurrent", { version: version ?? 0 })}
          </h2>
          <VersionView snapshot={snapshot.data} defaultTheme={previewPortalTheme()} />
        </>
      )}
    </div>
  );
}
