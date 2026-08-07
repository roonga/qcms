import type { A2UIAnswerValue, A2UIValues } from "@qcms/ui";

/**
 * Combining the answers the API holds with the ones the no-JS re-render cookie
 * carries (task 044, issue #327).
 *
 * This was an inline object spread in `native-step.tsx`. It is a named function
 * because the spread has a three-way behaviour that a comment kept losing: a key
 * **absent** from the context lets the stored answer show through, a key present
 * with a real value overrides it, and a key present with an explicit `undefined`
 * *also* overrides it, blanking the field. Absent and cleared look identical in a
 * JSON dump and are opposite renders, which is exactly how a validation change
 * once turned a refused answer back into the stale one it replaced.
 */

/**
 * The values a step should display: the answers the API holds for it, with the
 * just-submitted context laid over the top.
 *
 * **The context has to win, including when it clears.** After a rejected POST the
 * cookie carries what the respondent actually typed, which the API refused and so
 * does not hold; re-showing the stored answer would hide the input their error
 * message is about. That applies just as much when the typed value did not
 * survive the cookie round trip (a non-numeric number field becomes `NaN`, which
 * JSON writes as `null`, which validation clears): the field must go blank, not
 * back to the accepted answer the respondent was in the middle of changing.
 *
 * With no context at all (a plain resume, or the SSR first paint before
 * hydration) the stored answers are what the step displays.
 */
export function mergeStepValues(
  stored: Readonly<Record<string, A2UIAnswerValue>>,
  context: Readonly<Record<string, A2UIAnswerValue | undefined>> | undefined,
): A2UIValues {
  // A plain spread is correct precisely because it propagates an own property
  // whose value is `undefined`. Do not "tidy" this into something that skips
  // undefined entries (`Object.entries(...).filter(...)`, a `??` merge): that
  // silently turns every clear back into a fallback.
  return { ...stored, ...context };
}
