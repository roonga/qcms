import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormPageHeader } from "@/components/forms/form-page-header";
import { RulesScreen } from "@/components/forms/rules-screen";
import { Alert } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { readState } from "@/lib/read-state";
import { formVerdict } from "@/lib/server/form-verdict";
import { getForm, loadPinnableQuestions } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

import { previewConditionAction, saveDraftAction, validateDraftAction } from "../../actions";

/** The browser-tab title for this route (issue #536): the section, and the form it belongs to. */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("rules", formId));
}

/**
 * One form's rules (Code Owner, 2026-09-05, issue #669;
 * `plan/admin-shell-poc/rules-screen-poc.html`).
 *
 * ## Why this route exists
 *
 * `admin-shell-poc.html` draws the builder's Rules card as a compact read-only lens and
 * `rules-screen-poc.html` draws the editing on a screen of its own. That is the POC
 * speaking rather than the POC failing to speak - a card's contents are exactly what a
 * static drawing expresses - and under POC-wins the ruling is to build it as drawn.
 * `plan/admin-ux-audit.md` §5.5 priced the move as a two-hop path for rule-scoped issues,
 * "a real degradation to accept knowingly rather than discover", and it is accepted.
 *
 * The audit's objection was not the two hops, it was that anything resolving against ids on
 * the builder page would silently stop resolving. The ruling's mandatory constraint answers
 * it: every link that has to survive carries the route as well as the fragment
 * (`/forms/{formId}/rules#rule-{ruleId}`, `lib/forms/issues.ts`'s `ruleHref`), and the
 * handler switches route and then focuses. Validation went the other way and stays a
 * builder selection (#659, built as #719) because its entries point at controls the builder
 * itself renders; the pair is written up in `plan/admin-design-contracts.md` §7 so the two
 * halves read as one decision.
 *
 * ## Why the reads are the builder's reads
 *
 * This screen edits the same document, so it needs the same two things: the form's detail
 * (for the stored draft) and the pinnable-question library (for the sentences the table and
 * the condition editor read questions by). They are independent, so they run together, and
 * a library failure renders as a notice above a working editor rather than a 404 - a rule's
 * structure is still editable when the library cannot be listed. The library reaches the
 * client as a `ReadState` (`lib/read-state.ts`, issues 543, 544, 572) rather than as
 * `ok ? data : []`, because an empty library is not a neutral stand-in: every question
 * lookup misses against one, and "Unknown question" is a claim the failed read cannot
 * support.
 *
 * The three actions are bound to this route's form id, so a client cannot aim a save at a
 * form other than the one on screen whatever it puts in the payload.
 */
export default async function FormRulesPage({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;

  const [detail, library] = await Promise.all([
    getForm(session, formId),
    loadPinnableQuestions(session),
  ]);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;
  // The engine's verdict on the stored draft, so a reader who arrived from an issue link
  // sees the issue on the rule they were sent to rather than a clean table. Memoized per
  // request, so it is the same dry run the rail beside this screen already runs
  // (`lib/server/form-verdict.ts`). A form with no draft has nothing to validate.
  const verdict =
    form.draft === null ? undefined : await formVerdict(session, form.formId, form.draft);

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader formId={form.formId} slug={form.slug} section="rules" status={form.status} />

      {!library.ok && (
        <Alert variant="warning">
          {t("forms.error.libraryFailed", { message: library.message })}
        </Alert>
      )}

      <RulesScreen
        detail={form}
        library={readState(library)}
        {...(verdict === undefined ? {} : { verdict })}
        saveDraft={saveDraftAction.bind(null, form.formId)}
        validateDraft={validateDraftAction.bind(null, form.formId)}
        previewCondition={previewConditionAction.bind(null, form.formId)}
      />
    </div>
  );
}
