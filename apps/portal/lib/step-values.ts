import type { A2UIAnswerValue, A2UIValues } from "@roonga/qcms-ui";

export function mergeStepValues(
  stored: Readonly<Record<string, A2UIAnswerValue>>,
  context: Readonly<Record<string, A2UIAnswerValue | undefined>> | undefined,
): A2UIValues {
  // A plain spread is correct precisely because it propagates an own property whose
  // value is `undefined`. Anything that skips undefined entries turns a clear back into
  // a fallback.
  return { ...stored, ...context };
}
