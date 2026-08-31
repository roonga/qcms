import { cookies } from "next/headers";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Alert } from "@/components/kit";
import { BuilderBreadcrumb } from "@/components/forms/builder-breadcrumb";
import { FormActions } from "@/components/forms/form-actions";
import { CONCURRENT_NOTICE_COOKIE, isConcurrentNoticeDismissed } from "@/lib/builder-notice";
import { FormBuilder } from "@/components/forms/form-builder";
import type { FormDetail } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { readState } from "@/lib/read-state";
import { getForm, loadPinnableQuestions } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

import {
  previewConditionAction,
  publishFormAction,
  saveDraftAction,
  setFormStatusAction,
  updateSettingsAction,
  validateDraftAction,
} from "../actions";

/**
 * One form's builder (task 033; screen contract `admin-form-builder.md`).
 *
 * A server component that does three things and hands over: load the form, load the
 * library it can pin from, and bind the four mutations to this route's form id. Everything
 * after that is `FormBuilder`, which owns the working draft (the component contract's
 * single state owner) and receives the actions as props.
 *
 * ## Why the actions arrive as props rather than as imports
 *
 * `FormBuilder` is a `"use client"` module, and the import-surface test forbids a client
 * module from value-importing anything under `lib/server/`. Binding here keeps that line
 * intact and does something better besides: `formId` comes from the **route**, so a
 * client cannot aim an autosave at a form other than the one on screen, whatever it puts
 * in the payload.
 *
 * ## Two reads, one round trip
 *
 * The detail read and the library read are independent, so they run together. The library
 * is the expensive one (a list read plus a detail read per question, `lib/server/forms.ts`
 * explains why the list alone is not enough), and a builder that will not open because the
 * *question* library is unavailable would be the wrong failure: the form's own steps and
 * rules are all still editable. So a library failure renders as a notice above a working
 * builder, while a failure to load the form itself is a 404 or an error.
 *
 * The library reaches the builder as a `ReadState` (`lib/read-state.ts`, issue 543) rather
 * than as `ok ? data : []` (issues 572, 544). An empty library is not a neutral stand-in
 * on this screen: every pin lookup misses against one, so the collapsed form used to tag
 * every question in the form "Version not found" and offer a picker saying no published
 * version matched a search the author had not typed. Both are claims about the library,
 * and the read that would have supported them is the one that failed. The builder keeps
 * everything that edits the DRAFT, which was read successfully.
 */

/**
 * Seed the working draft's title from the create screen's `?title=`.
 *
 * `POST /admin/forms` takes an identity (`formId`, `slug`, `defaultLocale`) and no title,
 * because a title belongs to the *definition* and a definition with no steps is not one
 * the kernel would accept yet. The create form still asks for a title, because that is
 * the moment an author has one in mind, so it travels in the query string and lands in
 * the draft here. Only an entirely empty title is seeded: anything already stored is the
 * author's and is never overwritten by a stale link.
 */
function seedTitle(detail: FormDetail, title: string): FormDetail {
  if (title === "" || detail.draft === null) return detail;
  if (Object.values(detail.draft.title).some((text) => text !== "")) return detail;
  return {
    ...detail,
    draft: { ...detail.draft, title: { [detail.defaultLocale]: title } },
  };
}

function firstValue(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? "";
}

/** The browser-tab title for this route (issue #536): the section, and the form it belongs to. */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("builder", formId));
}

export default async function FormBuilderPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ formId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;
  const query = await searchParams;

  const [detail, library] = await Promise.all([
    getForm(session, formId),
    loadPinnableQuestions(session),
  ]);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }

  const form = seedTitle(detail.data, firstValue(query["title"]).trim());

  return (
    <div className="flex flex-col gap-6">
      {/* The breadcrumb stays on both of the builder's screens, because it is about the
          ROUTE and the route does not change when the rail switches what the column is
          showing. What follows it - the form's name, its identity line and where its draft
          came from - is about the form, so it is handed to the builder and rendered on the
          form's own screen (Code Owner, 2026-08-26). It used to stand above both, so a
          reader working on a step read four lines of form metadata above that step's
          questions every time. */}
      <BuilderBreadcrumb formId={form.formId} slug={form.slug} />

      {!library.ok && (
        <Alert variant="warning">
          {t("forms.error.libraryFailed", { message: library.message })}
        </Alert>
      )}

      {/* PUBLISH AND CLOSE/REOPEN RIDE INSIDE THE BUILDER NOW (Code Owner, 2026-08-26),
          on the screen that carries the form's own details, because that is what they act
          on: they publish the FORM and they close the FORM, and standing them above a
          column that is usually showing one step said they were about the step.

          Passed as a node rather than imported by the builder, which keeps `FormActions`
          a server component holding its own bound actions - a client component cannot
          bind a server action, and making the builder import it would drag the whole
          publish surface into the client bundle for no reason.

          The reason they used to sit above the builder still holds and is now handled
          where it belongs: a refused publish renders an anchored work list whose links
          move focus to the rule, step or pin at fault. A pin lives on a step screen this
          one is not showing, so `IssueEntry` selects the owning step first and then
          focuses - see `components/forms/validation-panel.tsx`. */}
      <FormBuilder
        detail={form}
        library={readState(library)}
        // Read on the request rather than after mount, so a screen that will not show the
        // notice never renders it and then takes it away.
        concurrentNoticeRead={isConcurrentNoticeDismissed(
          (await cookies()).get(CONCURRENT_NOTICE_COOKIE)?.value,
        )}
        formMeta={
          // One muted line of bare values. They were three labelled lines - "Form ID:",
          // "Default locale:", "Status:" and then the draft's origin on its own - which is
          // a lot of chrome for facts an author reads once and then never looks at again.
          // The values say what they are: an id looks like an id, and a status is a word.
          <p className="text-sm text-(--color-text-muted)">
            {form.formId} · {form.defaultLocale} · {t(`forms.status.${form.status}`)} ·{" "}
            {t(`forms.builder.draftSource.${form.draftSource}`)}
          </p>
        }
        formActions={
          <FormActions
            formId={form.formId}
            slug={form.slug}
            status={form.status}
            draft={form.draft}
            latestVersion={form.versions[0]?.version}
            publish={publishFormAction.bind(null, form.formId)}
            setStatus={setFormStatusAction.bind(null, form.formId)}
          />
        }
        saveDraft={saveDraftAction.bind(null, form.formId)}
        validateDraft={validateDraftAction.bind(null, form.formId)}
        updateSettings={updateSettingsAction.bind(null, form.formId)}
        previewCondition={previewConditionAction.bind(null, form.formId)}
      />
    </div>
  );
}
