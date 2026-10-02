"use server";

import type { A2UIAnswerValue } from "@roonga/qcms-ui";
import { headers } from "next/headers";

import { t } from "@/lib/i18n/en";
import { focusAfterAdd, focusAfterRemoval, type RosterActionState } from "@/lib/repeat";
import { ApiError, getStep, rosterOp } from "@/lib/server/api";
import { isSameOriginAction } from "@/lib/server/route-helpers";
import { readSessionToken } from "@/lib/server/session-cookie";
import { decodeStepForm, type DecodedAnswer } from "@/lib/server/step-form";
import type { NativeFieldKind } from "@roonga/qcms-ui/native-submit";

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
 * ## It runs SEC-9's belt itself, and Next's own check is not a substitute
 *
 * Ruled by the Code Owner on 2026-10-01 (R-B2). Next does verify an action's origin:
 * it compares the request's `Origin` to the `Host` or `X-Forwarded-Host` and refuses a
 * mismatch. That is weaker than the belt in three ways, each of which matters on a
 * public respondent surface:
 *
 * - it **admits a request carrying no `Origin` at all**, after only a warning;
 * - it compares the host while **ignoring the scheme**;
 * - it **never reads `Sec-Fetch-Site`**, which is the header the belt relies on.
 *
 * So this action is the sixth caller of `isSameOriginPost` and writes the same refusal
 * log line as the other five, with its own `BeltRoute` template (`/s/{sessionId}`,
 * because an action runs against the page that declares it) and its own outcome
 * (`rendered-unchanged`: the respondent is already on the page the action answers
 * with). `scripts/check-origin-guards.test.ts` enumerates it and says where its
 * coverage lives, so a second action added without a belt is a red gate.
 *
 * Next's check still matters in one direction: it is why the portal serves
 * `Referrer-Policy: same-origin` (SEC-9 as amended, 2026-10-01). Under `no-referrer` a
 * navigation POST serializes its `Origin` as the literal `null`, which Next refuses
 * outright, so the operation died in the framework before the belt could admit it.
 *
 * ## Why its state type lives in `lib/repeat.ts`
 *
 * A `"use server"` file may export **async functions and nothing else**. Exporting the
 * initial state object from here made Next answer the action's own POST with a 500 and
 * log "A `use server` file can only export async functions, found object", which reads
 * as a broken mechanism rather than a misplaced export. The type and the constant are
 * therefore in the shared module both this and the view import.
 *
 * ## R2
 *
 * It decides nothing. It decodes a form, calls two API endpoints and hands back what
 * to re-show. Whether the group may grow, whether the token was already spent and
 * which instances are live are all the API's answers.
 */

/** The typed values from one whole-step post, for the re-render to show again. */
function typedValues(
  answers: readonly DecodedAnswer[],
  cleared: Readonly<Record<string, NativeFieldKind>>,
): Record<string, A2UIAnswerValue> {
  const values: Record<string, A2UIAnswerValue> = {};
  for (const answer of answers) {
    // A decoded `null` is a CLEARED field, and it is carried back as EMPTY rather than
    // dropped. Dropping it would re-render the field from what the API holds, which this
    // post deliberately did not change, so a respondent who emptied a field would watch
    // the old answer reappear with no explanation. The record settles it: "the Add post
    // writes no answer, so an emptied required field on it is neither stored nor
    // retracted, and the field comes back still empty with the step unchanged"
    // (`plan/repeating-groups-and-table-input.md` section 4.2).
    //
    // Which is exactly the pair of facts that keeps `docs/portal-constraints.md`'s "a
    // required question cannot be CLEARED without scripting" bullet unchanged: the LEDGER
    // is untouched, and the form showing the clear is not the clear taking effect. It
    // takes effect, or is refused, on Continue.
    if (answer.value === null) {
      values[answer.questionId] = cleared[answer.questionId] === "multi" ? [] : "";
      continue;
    }
    values[answer.questionId] = answer.value as A2UIAnswerValue;
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
  _previous: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  // SEC-9's belt, first, exactly as every belted route handler runs it above its
  // credential read. An action gets no `Request`, so its headers are wrapped back into
  // the shape the belt reads (`isSameOriginAction`); the decision and the refusal line
  // are the one implementation.
  const { answers, cleared, rosterOp: operation, sessionId } = decodeStepForm(formData);
  const values = typedValues(answers, cleared);
  // The ROUTE TEMPLATE rather than the concrete path, and deliberately: the belt
  // compares origins and never reads the path, the refusal line's `beltRoute` is derived
  // by matching this against the route table, and the only session id available here came
  // out of the posted form. Passing that would put a respondent-supplied string into a log
  // line for nothing.
  if (!isSameOriginAction(await headers(), "/s/{sessionId}")) {
    // The same shape as every other belt refusal on this surface: nothing is applied,
    // and the respondent gets their own step back. Their typed values still ride the
    // re-render, because a request that could not prove its origin is still a request
    // whose body this page rendered the fields for.
    return { values, message: t("repeat.failed") };
  }
  // No operation in the post: nothing to apply, and the re-render still shows what the
  // respondent typed. Reachable only from a forged post, since every path into this
  // action is a `__qop` button.
  if (operation === undefined || sessionId === undefined) return { values };

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
    // After an add, the new instance's heading, named by the operation's own `minted`
    // report rather than inferred.
    return {
      values,
      autofocusId: focusAfterAdd(result.minted, operation.groupId),
    };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // A refused operation still re-renders the step with every typed value, which is
    // the whole point of the carrier: the respondent loses nothing by being told no.
    return { values, message: refusalMessage(error) };
  }
}
