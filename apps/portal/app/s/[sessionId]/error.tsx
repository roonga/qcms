"use client";

import { MessageScreen } from "@/components/message-screen";
import { t } from "@/lib/i18n/en";
import { buttonClass } from "@/lib/ui";

/**
 * The flow segment's error boundary: the screen for an error thrown **while this segment
 * renders** (task 073).
 *
 * ## What it does NOT catch, which this comment used to claim it did
 *
 * It does not catch a stale Server Action id. Next recalculates action ids between builds,
 * so a respondent with scripting off who holds a step page across a deploy posts an id the
 * new build does not know, and Next's action handler validates every id and refuses it
 * **before this segment renders**. An App Router error boundary catches what its own
 * subtree throws while rendering; a request that never got that far reaches no boundary. A
 * crafted post with an unknown action id showed the framework's own response instead, which
 * is how the claim was found to be false (PR #1034's review, 2026-10-02).
 *
 * **Nor does anything else this app can write.** Since next 16.4.0 a production build
 * answers that request with **`409 Conflict`, `text/plain`, `Server Action unavailable.`
 * and the header `x-nextjs-action-not-found: 1`**, and a *malformed* id with `400` and
 * `Invalid Server Action request.`; before 16.4.0 both were a bare
 * `500 text/plain "Internal Server Error"`. The status changed and the reachability did
 * not: an App Router `app/500/page.tsx` and a Pages Router `pages/_error.tsx` were both
 * tried and neither is consulted, so no page this repository owns renders for any of them.
 * ADR-43's amendment of 2026-10-10 carries the measurements, and the respondent's recovery
 * is a reload either way.
 *
 * ## What it does catch, and why the screen still reads this way
 *
 * Any uncaught error thrown while rendering this segment, whatever the cause: a read that
 * threw where `page.tsx` did not classify it, a renderer fault on a shape the API served.
 * Every one of them has the same remedy from the respondent's side, which is to re-read the
 * step, so the screen says the page was out of date and offers it.
 *
 * **Nothing committed is lost when it happens, and that is a property of the mechanism
 * rather than of this screen.** Every answer the respondent had already pressed Continue on
 * is in the ledger, and the roster is server state, so it is whatever it was. What they lose
 * is the values typed into the current step since their last Continue, which is the same
 * thing they would lose by closing the tab, and the step they land on is the current one.
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
