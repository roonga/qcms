import type { A2UIAnswerValue, A2UIValues } from "@roonga/qcms-ui";

/**
 * The answers the API holds, with the no-JS re-render context laid over the top.
 *
 * The spread has a three-way behaviour: a key absent from the context lets the stored
 * answer show through, a key with a real value overrides it, and a key with an explicit
 * `undefined` also overrides it, blanking the field. Absent and cleared look identical
 * in a JSON dump and are opposite renders.
 *
 * The context has to win, including when it clears. After a rejected POST it carries
 * what the respondent typed and the API does not hold, so re-showing the stored answer
 * would hide the input their error message is about.
 */
export function mergeStepValues(
  stored: Readonly<Record<string, A2UIAnswerValue>>,
  context: Readonly<Record<string, A2UIAnswerValue | undefined>> | undefined,
): A2UIValues {
  // A plain spread is correct precisely because it propagates an own property whose
  // value is `undefined`. Anything that skips undefined entries turns a clear back into
  // a fallback.
  return { ...stored, ...context };
}
