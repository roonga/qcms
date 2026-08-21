import { t, type MessageKey } from "@/lib/i18n/en";
import { formatDateTime } from "@/lib/i18n/format";

/**
 * The two save-model statements, in one module (issue 518; design-language element 7;
 * `plan/admin-design-contracts.md` §6, `plan/admin-ux-audit.md` §4.6).
 *
 * The audit's finding was that this app has two save models and names neither: the form
 * builder autosaves on a debounce, the question editor is a plain form with a Save button,
 * and an author who learns the first will assume the second. The failure mode is silent
 * data loss on a screen that never claimed to autosave, so the fix is a *statement* on
 * each screen rather than a nicer indicator on one of them.
 *
 * Both statements live here, in one file, because the contract they implement is a
 * dichotomy: a screen is autosaving or it is manual, it says so exactly once, and the two
 * sentences have to stay recognisably a pair. Split across the two feature folders they
 * would drift into two vocabularies, which is the defect rather than the fix.
 *
 * ## Why the ambient strip is not in the validation panel
 *
 * It used to be: the builder's save state was a second sentence inside the validation
 * panel's live region, in the right-hand column. Element 7 objects to that placement and
 * `plan/admin-ux-audit.md` §5.6 explains what the move has to avoid - the panel must stay
 * the **single authoritative issue count** on that screen, so the strip that replaces it
 * must not look like a second thing that counts issues. Nothing here renders a number, the
 * word "issue", or anything derived from the issue list; the strip's whole vocabulary is
 * the save model and the save state, and the panel's whole vocabulary is issues.
 *
 * ## What a screen-reader user hears during sustained typing
 *
 * The live region is the settled outcome only, and its timestamp has minute granularity
 * (`plan/admin-design-contracts.md` §2: date, `HH:MM`, zone, no seconds). Both of those
 * are churn controls rather than incidental choices.
 *
 * - **The model sentence is static**, so it is never announced. It is a permanent
 *   statement an author can read at any time, not an event.
 * - **The in-flight sentence is `aria-hidden`.** "Saving..." changes twice per typing
 *   pause and resolves itself; announcing it would double every cycle to tell the user
 *   nothing they can act on. It stays visible because a sighted author reads it as motion.
 * - **The settled sentence is the live region**, and because it carries no seconds, every
 *   save inside the same minute renders the *identical* string - and an `aria-live` region
 *   announces on change, so identical text is silent. Sustained typing therefore produces
 *   roughly one announcement per minute ("Saved 20 Aug 2026, 02:14 PM UTC"), not one per
 *   debounce settle. A failure is the exception and announces immediately, because that is
 *   the one save state an author has to act on.
 *
 * The seconds the old indicator carried were load-bearing for one caller - the e2e helper
 * that waits for a *different* sentence to prove a second save landed. That is what
 * `data-saved-at` is for: the machine-readable instant, with the precision a test needs,
 * kept out of the sentence a person hears.
 */

/**
 * The persistent save-status chrome for an autosaving screen. Exactly one screen in this
 * app autosaves (the form builder), and this is the only save statement it carries.
 *
 * The props are deliberately not the builder's own status union. An ambient strip needs
 * three facts - is a save in flight, did the last save fail, when did the last one land -
 * and the builder's `status` conflates a failed *store* with a failed *validation* round
 * trip, which is not a save failure and must not be reported as one.
 */
export function AmbientSaveStatus({
  isSaving,
  hasFailed,
  savedAt,
}: {
  readonly isSaving: boolean;
  readonly hasFailed: boolean;
  /** ISO instant of the last successful save, or `undefined` before the first this visit. */
  readonly savedAt: string | undefined;
}) {
  return (
    <p
      data-testid="qcms-save-status"
      // React omits an attribute whose value is `undefined`, so this is absent until the
      // first save rather than present and empty.
      data-saved-at={savedAt}
      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-(--color-border) bg-(--color-background-muted) px-3 py-2 text-sm text-(--color-text-muted)"
    >
      <span data-testid="qcms-save-model" className="font-medium text-(--color-text)">
        {t("forms.save.model")}
      </span>
      <span aria-live="polite" data-testid="qcms-save-state">
        {settledSaveState(hasFailed, savedAt)}
      </span>
      {isSaving && (
        <span aria-hidden="true" data-testid="qcms-save-progress">
          {t("forms.save.saving")}
        </span>
      )}
    </p>
  );
}

/** Where the autosave has got to, once it has got somewhere. */
function settledSaveState(hasFailed: boolean, savedAt: string | undefined): string {
  if (hasFailed) return t("forms.save.failed");
  if (savedAt !== undefined) return t("forms.save.saved", { time: formatDateTime(savedAt) });
  return t("forms.save.idle");
}

/**
 * The manual-model statement for a screen whose changes are stored by an explicit press.
 *
 * A visible paragraph, never a tooltip or a `title` attribute: the point is that an author
 * who has not gone looking still meets it. It is rendered immediately *before* its button
 * in DOM order so a linear read reaches the statement on the way to the control, which is
 * the closest thing available to describing the button without changing the vendored
 * `Button` (it takes no `aria-describedby`, and adding one is a component-guidelines change
 * rather than a screen change).
 *
 * There is no companion "Saved" strip, by rule: contract §6 forbids ambient save chrome on
 * a screen with a Save button, because that combination is exactly the confusion §4.6
 * describes. A post-submit success alert is a different thing - it reports the outcome of
 * an action the author took - and is not affected.
 */
export function ManualSaveNote({ messageKey }: { readonly messageKey: MessageKey }) {
  return (
    <p data-testid="qcms-manual-save-note" className="text-sm text-(--color-text-muted)">
      {t(messageKey)}
    </p>
  );
}
