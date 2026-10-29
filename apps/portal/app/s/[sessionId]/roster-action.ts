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

// It runs SEC-9's belt itself, because Next's own action check admits a request with no `Origin`, ignores the scheme and never reads `Sec-Fetch-Site`.

function typedValues(
  answers: readonly DecodedAnswer[],
  cleared: Readonly<Record<string, NativeFieldKind>>,
): Record<string, A2UIAnswerValue> {
  const values: Record<string, A2UIAnswerValue> = {};
  for (const answer of answers) {
    // A cleared field is carried back as empty rather than dropped: dropping it would
    // re-render from what the API still holds, so a respondent who emptied a field would
    // watch the old answer reappear. The clear takes effect, or is refused, on Continue.
    if (answer.value === null) {
      values[answer.questionId] = cleared[answer.questionId] === "multi" ? [] : "";
      continue;
    }
    values[answer.questionId] = answer.value as A2UIAnswerValue;
  }
  return values;
}

// Never the API's own words (ADR-27).
function refusalMessage(error: ApiError): string {
  if (error.code === "REPEAT_MAX_REACHED") return t("repeat.maxReached");
  if (error.code === "REPEAT_NOT_ADDABLE") return t("repeat.notAddable");
  return t("repeat.failed");
}

export async function rosterOperation(
  _previous: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  const { answers, cleared, rosterOp: operation, sessionId } = decodeStepForm(formData);
  const values = typedValues(answers, cleared);
  // SEC-9's belt, above the credential read. The route template rather than the concrete
  // path: the belt never reads the path, and the only session id available here came out
  // of the posted form, so passing it would log a respondent-supplied string for nothing.
  if (!isSameOriginAction(await headers(), "/s/{sessionId}")) {
    // Nothing is applied, and the typed values still ride the re-render.
    return { values, message: t("repeat.failed") };
  }
  if (operation === undefined || sessionId === undefined) return { values };

  const token = await readSessionToken();
  // The page's own read fails too and renders the recovery screen, so there is nothing
  // useful to say from here.
  if (token === undefined) return { values };

  try {
    // Read rather than inferred: "the instance that took the removed one's place" is a
    // fact about the order before the removal, which the operation's response cannot
    // report.
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
    // On a `perInstanceStep` group the new instance is a view one page further along and
    // is not in this document, so there is nothing to focus.
    const paginated = before.view.groupId === operation.groupId;
    const autofocusId = focusAfterAdd(result.minted, operation.groupId, paginated);
    return { values, ...(autofocusId === undefined ? {} : { autofocusId }) };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // A refused operation still re-renders the step with every typed value, so the
    // respondent loses nothing by being told no.
    return { values, message: refusalMessage(error) };
  }
}
