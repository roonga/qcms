"use server";

import type { A2UIAnswerValue } from "@roonga/qcms-ui";

import { t } from "@/lib/i18n/en";
import { focusAfterAdd, focusAfterRemoval } from "@/lib/repeat";
import { ApiError, getStep, rosterOp } from "@/lib/server/api";
import { readSessionToken } from "@/lib/server/session-cookie";
import { decodeStepForm } from "@/lib/server/step-form";

/**
 * The no-JS roster operation: a **Next Server Action** on the step form (task 073,
 * ADR-43 as amended, Code Owner 2026-10-01).
 *
 * ## Why an action and not a route handler
 *
 * An Add or Remove must re-show the whole step with every typed value intact and
 * commit no answer. The values are the whole step rather than a refused subset, and a
 * nine-instance step does not fit a 4 KB cookie, so the carrier has to be the POST
 * body itself and the response has to be the step. A Route Handler cannot render the
 * page (Next injects the stylesheet and script tags at render time) and an App Router
 * page answers GET and HEAD only, so a POST to it is a 405 and a segment cannot hold
 * both files. A Server Action is the framework's own answer: it runs against the page
 * that declares it, and on the no-JS path Next runs it and then renders that page's
 * HTML **in the same 200 response**.
 *
 * The values reach that render through `useActionState`, whose returned state React
 * renders server-side before any hydration: the action is handed the `FormData` and
 * returns what the step should re-show.
 *
 * ## What it does and does not commit
 *
 * **It applies the roster operation and writes no answer**, which is the ruling of
 * 2026-09-30 rather than an implementation choice. The typed values are decoded here
 * only to be handed back to the render; they reach the ledger when the respondent
 * presses Continue, under the ordinary validation an ordinary Continue does. That is
 * what makes `formnovalidate` on the Add and Remove buttons safe rather than merely
 * convenient, and it is why `docs/portal-constraints.md`'s "a required question cannot
 * be CLEARED without scripting" bullet is unchanged.
 *
 * ## Why there is no origin belt here
 *
 * Next verifies a Server Action's own origin: it compares the request's `Origin` to
 * the `Host` or `X-Forwarded-Host` and refuses a mismatch. That is why the portal
 * serves `Referrer-Policy: same-origin` (SEC-9 as amended, 2026-10-01): under
 * `no-referrer` a navigation POST serializes its `Origin` as the literal `null`, which
 * Next refuses, so the operation died in the framework. `scripts/check-origin-guards.test.ts`
 * enumerates this action and states that reasoning, so a second action added without
 * one is a red gate rather than a silent gap.
 *
 * ## R2
 *
 * It decides nothing. It decodes a form, calls two API endpoints and hands back what
 * to re-show. Whether the group may grow, whether the token was already spent and
 * which instances are live are all the API's answers.
 */

/** What an Add or Remove hands back for the re-render of the step it posted from. */
export interface RosterActionState {
  /**
   * Every value the respondent had typed, keyed by the field's own name: a bare
   * questionId outside a repeating group and `instanceId/questionId` inside one.
   *
   * This is the carrier. It is the whole step rather than a refused subset, which is
   * why it rides the POST body and the 200 rather than a cookie.
   */
  readonly values: Readonly<Record<string, A2UIAnswerValue>>;
  /**
   * The DOM id this render lands focus on, which becomes an `autofocus` attribute
   * (Q11, and the 2026-10-01 ruling that it is `autofocus` and never a fragment).
   */
  readonly autofocusId?: string;
  /** A sentence to show when the API refused the operation. */
  readonly message?: string;
}

/** Nothing typed, nothing landed: the state before the respondent presses anything. */
export const NO_ROSTER_ACTION: RosterActionState = { values: {} };

/** The typed values from one whole-step post, for the re-render to show again. */
function typedValues(
  answers: readonly { questionId: string; value: unknown }[],
): Record<string, A2UIAnswerValue> {
  const values: Record<string, A2UIAnswerValue> = {};
  for (const answer of answers) {
    // A decoded `null` is a CLEARED field rather than a value. It is not recorded, so
    // the field re-renders from what the API holds - which, since this post writes no
    // answer, is still the old answer. That is the ruled behaviour and the reason the
    // "cannot be cleared without scripting" bullet is unchanged: an emptied required
    // field on an Add post is neither stored nor retracted.
    if (answer.value !== null) values[answer.questionId] = answer.value as A2UIAnswerValue;
  }
  return values;
}

/** The sentence a refused operation shows. Never the API's own words (ADR-27). */
function refusalMessage(error: ApiError): string {
  if (error.code === "REPEAT_MAX_REACHED") return t("repeat.maxReached");
  if (error.code === "REPEAT_NOT_ADDABLE") return t("repeat.notAddable");
  return t("repeat.failed");
}

export async function rosterOperation(
  sessionId: string,
  _previous: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  const { answers, rosterOp: operation } = decodeStepForm(formData);
  const values = typedValues(answers);
  // No operation in the post: nothing to apply, and the re-render still shows what the
  // respondent typed. Reachable only from a forged post, since every path into this
  // action is a `__qop` button.
  if (operation === undefined) return { values };

  const token = await readSessionToken();
  // No credential: the page's own read fails too and it renders the recovery screen,
  // so there is nothing useful to say from here.
  if (token === undefined) return { values };

  try {
    // The roster as the page the respondent pressed on rendered it. It is read rather
    // than inferred because "the instance that took the removed one's place" is a fact
    // about the order BEFORE the removal, and the operation's own response can only
    // report the order after it.
    const before = await getStep(sessionId, token);
    const rosterBefore =
      before.rosters.find((entry) => entry.groupId === operation.groupId)?.instances ?? [];

    const result = await rosterOp(sessionId, token, {
      op: operation.op,
      groupId: operation.groupId,
      ...(operation.instanceId !== undefined ? { instanceId: operation.instanceId } : {}),
      opToken: operation.token,
    });

    if (operation.op === "remove") {
      return {
        values,
        autofocusId: focusAfterRemoval(rosterBefore, operation.instanceId ?? "", operation.groupId),
      };
    }
    // After an add, the new instance's heading. A REPLAYED post minted nothing - the
    // one-time token had already been spent - so the difference between the two rosters
    // is empty and the landing is the group's Add button, which is the honest answer:
    // the instance the first post created is already on the page and focus has not
    // moved since.
    const after =
      result.rosters.find((entry) => entry.groupId === operation.groupId)?.instances ?? [];
    return {
      values,
      autofocusId: focusAfterAdd(rosterBefore, after, operation.groupId),
    };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // A refused operation still re-renders the step with every typed value, which is
    // the whole point of the carrier: the respondent loses nothing by being told no.
    return { values, message: refusalMessage(error) };
  }
}
