"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  const [modelOpen, setModelOpen] = useState(false);
  const modelId = useId();
  return (
    <div className="flex flex-col items-end gap-1">
      <p
        data-testid="qcms-save-status"
        // React omits an attribute whose value is `undefined`, so this is absent until
        // the first save rather than present and empty.
        data-saved-at={savedAt}
        className="flex items-baseline justify-end gap-x-2 text-sm text-(--color-text-muted)"
      >
        {/* ONE SLOT, not two side by side (Code Owner, 2026-08-26). The model sentence and
          the state used to sit next to each other, and a third span appeared while a save
          was in flight, so the whole strip changed width three times per save and visibly
          moved. Now the state is the only thing here and it says one thing at a time.

          The strip is anchored to the END of its row, so the control beside it does not
          move as the text grows and shrinks to its left. */}
        <span aria-live="polite" data-testid="qcms-save-state">
          {isSaving ? t("forms.save.saving") : settledSaveState(hasFailed, savedAt)}
        </span>
        {/* The model sentence, behind a "?" (Code Owner, 2026-08-26). Design-language
          element 7 and `plan/admin-design-contracts.md` §6 ask each screen to STATE how it
          saves, and the amendment is to how it is said rather than to whether: it is one
          press away on the screen it describes, next to the state it explains, instead of
          a sentence that never changes occupying the row forever. Recorded in the contract
          rather than only here.

          `SaveModelHelp` is a sibling rather than part of this element so that the live
          region above stays exactly the settled sentence: an expandable paragraph inside a
          `polite` region would be announced as a change when it opened. */}
        {/* LAST IN THE ROW, and the row is anchored to its end, so this button does not
            move when anything beside it changes - not when the state grows from "Not
            saved yet" to a full timestamp, and not when the sentence below appears. A
            control that moves out from under the pointer as it is pressed is the defect
            this shape exists to avoid, and it is why the sentence is a sibling of this
            row rather than another item inside it. */}
        <button
          type="button"
          className="qcms-help-dot"
          aria-expanded={modelOpen}
          aria-controls={modelId}
          aria-label={t("forms.save.modelLabel")}
          onClick={() => {
            setModelOpen((wasOpen) => !wasOpen);
          }}
        >
          <span aria-hidden="true">{"?"}</span>
        </button>
      </p>
      {modelOpen && (
        <p
          id={modelId}
          data-testid="qcms-save-model"
          className="max-w-measure-narrow text-end text-sm text-(--color-text)"
        >
          {t("forms.save.model")}
        </p>
      )}
    </div>
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

/**
 * A brief "Saved" beside the work it saved, for the screen that carries no strip.
 *
 * ## Why this exists at all
 *
 * The ambient strip is the FORM's, and it moved to the form's own screen when the builder
 * became two screens (Code Owner, 2026-08-26). That left the step screen - where most
 * editing actually happens - with no standing sign that anything was being stored. This is
 * that sign, and it is deliberately the smaller of the two: the strip states the save
 * MODEL persistently, which is what design-language element 7 is about, while this states
 * one save and then gets out of the way.
 *
 * `plan/admin-design-contracts.md` §6's "exactly one save statement per screen" is kept
 * rather than bent: the form screen has the strip and not this, the step screen has this
 * and not the strip. Neither screen shows two.
 *
 * ## Why it does not announce
 *
 * `aria-hidden`, and that is a judgement rather than an oversight. This fires on every
 * debounced autosave - which is to say every few keystrokes - and a live region saying
 * "Saved" that often is hostile to anyone listening to it. The strip's own live region is
 * the announced statement, and it is on the form screen where it changes at most once a
 * minute. What a screen reader still gets on THIS screen is every save that goes wrong:
 * autosave-paused and save-failed are alerts, and they stay on both screens.
 *
 * ## Why it takes no space when it is gone
 *
 * It sits in the step heading's own row, whose height is set by the heading beside it. A
 * transient element in the flow of a column would push the screen down as it arrived and
 * pull it back as it left, which is a layout shift twice per save.
 */
export function AutosaveFlash({ savedAt }: { readonly savedAt: string | undefined }) {
  const [visible, setVisible] = useState(false);
  // The instant this component has already accounted for, seeded with whatever was true
  // when it mounted. Without it, arriving on a step after ANY earlier save this visit
  // flashed "Saved" for a save that had happened minutes ago on another screen: the effect
  // fires on mount, and a mount is not an event worth confirming.
  const acknowledged = useRef(savedAt);

  useEffect(() => {
    if (savedAt === undefined || savedAt === acknowledged.current) return undefined;
    acknowledged.current = savedAt;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
    }, FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [savedAt]);

  if (!visible) return null;
  return (
    <span className="qcms-autosave-flash" data-testid="qcms-autosave-flash" aria-hidden="true">
      {t("forms.save.flash")}
    </span>
  );
}

/** How long the flash stands. Long enough to notice, short enough not to be chrome. */
const FLASH_MS = 1800;
