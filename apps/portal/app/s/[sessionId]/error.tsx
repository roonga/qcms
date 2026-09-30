"use client";

import { MessageScreen } from "@/components/message-screen";
import { t } from "@/lib/i18n/en";
import { buttonClass } from "@/lib/ui";

/**
 * The flow segment's error boundary, and it exists for one named failure (task 073).
 *
 * ## A stale Server Action id
 *
 * The no-JS Add and Remove of a repeating group is a Next Server Action, and **Next
 * recalculates action ids between builds**: an id is a build-time secret keyed to the
 * deployment. A respondent with scripting off who has a step page open when a new build
 * rolls out posts the id the old build gave them, and Next answers that with an error
 * rather than by running anything. Without a boundary here the respondent would see the
 * framework's error page, which says nothing they can act on.
 *
 * **Nothing is lost when it happens, and that is a property of the mechanism rather
 * than of this screen.** An Add or Remove commits no answer, so a refused one writes
 * nothing; every answer the respondent had already pressed Continue on is in the ledger;
 * and the roster is server state, so it is whatever it was. What they lose is the values
 * typed into the current step since their last Continue, which is the same thing they
 * would lose by closing the tab, and the step they land on is the current one.
 *
 * The recovery is deliberately a **link and not a button**: a boundary that needs the
 * `reset()` callback needs JavaScript, and the respondent this screen exists for has
 * none. A plain anchor to the flow page is a GET, so it re-reads the step from the API
 * and the respondent carries on.
 *
 * ## Why it is not narrower
 *
 * It catches any uncaught error thrown while rendering this segment, not only a stale
 * action id, and it says the same thing for all of them. That is honest: every cause
 * reachable here has the same remedy from the respondent's side, which is to reload the
 * step, and the alternative is guessing at framework error shapes that are not a
 * documented contract. A read failure the page CAN classify (an expired session, a
 * superseded snapshot) never reaches here, because `page.tsx` catches its own read and
 * renders the screen that names it.
 */
export default function FlowError() {
  return (
    <MessageScreen
      tone="neutral"
      title={t("repeat.staleStep.title")}
      body={t("repeat.staleStep.body")}
    >
      {/* A plain anchor, because the respondent this screen exists for has no
          JavaScript and a boundary's `reset()` needs it. `.` is the segment's own
          path, so this is a GET of the current step. */}
      <a href="." className={buttonClass("primary")} data-testid="stale-step-continue">
        {t("action.continue")}
      </a>
    </MessageScreen>
  );
}
