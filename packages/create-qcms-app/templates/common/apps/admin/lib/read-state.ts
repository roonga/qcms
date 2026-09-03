/**
 * How a screen hands the outcome of a read to the component that renders it
 * (issue 543; the pattern issue 544 filed).
 *
 * ## The bug this type exists to make unwritable
 *
 * `<List items={result.ok ? result.data : []} />` throws away the one bit that matters.
 * Three states arrive from the server - read failed, read succeeded with nothing, read
 * succeeded with rows - and two branches leave. The component then renders its zero-items
 * state for a failure, so the screen asserts something it does not know. On the
 * dead-letter queue that assertion was "nothing is stuck", printed underneath the alert
 * saying the queue could not be read, on the one screen that exists to answer whether
 * anything is stuck. Contract §3 (`plan/admin-design-contracts.md`) states the rule:
 * error states are not empty states.
 *
 * ## Why a discriminated union rather than a `failed` flag
 *
 * The alternative considered - keeping the array prop and adding `readFailed?: boolean`
 * beside it - was rejected because it leaves the contradiction representable:
 * `{ items: [rowA], readFailed: true }` type-checks and means nothing, and every
 * component then has to decide which of the two props wins. The union makes the
 * combination unsayable, which is the only reason a shared contract beats seven local
 * conventions. It is also the shape this app already reads answers in: `ApiResult` from
 * `lib/server/api-result.ts` discriminates on the same `ok` key, so a page passes its
 * read on rather than translating it.
 *
 * ## Why it is not `ApiResult` itself
 *
 * Two reasons, both about what crosses into the client bundle. `ApiResult`'s failure
 * branch carries `code`, `message` and `issues`; the page renders the message in its own
 * alert (that is where an error belongs, §3) and the component below needs none of it, so
 * passing the whole result would serialise API error detail into the client payload for a
 * component that never reads it (SEC-8's minimality). And `ApiResult` lives in
 * `lib/server/`, which is where the reads live and not where a `"use client"` component
 * should be importing from. `readState` narrows at the page boundary instead.
 *
 * ## What the component does with a failure is the component's decision
 *
 * This type deliberately says only "the read failed", not what to draw. A component whose
 * every affordance depends on the read (the dead-letter queue: there is nothing to
 * redeliver) renders its heading and stops. A component that still has work to offer (an
 * endpoint editor can still create an endpoint when the list of existing ones did not
 * load) renders that work and suppresses only the part that would claim knowledge of the
 * data. Suppressing a working capability because a different read failed is not what §3
 * asks for.
 */

/** Success carries the payload; failure carries nothing, because the page owns the alert. */
export type ReadState<T> = { readonly ok: true; readonly data: T } | { readonly ok: false };

/** One shared instance: the failure branch has no fields to distinguish. */
const FAILED: ReadState<never> = { ok: false };

/**
 * Narrow a read's result to what a rendering component is allowed to know.
 *
 * Takes the `ApiResult` shape structurally rather than by import, so this module stays out
 * of `lib/server/` and any future read shape discriminating on `ok` fits without a change
 * here.
 */
export function readState<T>(
  result: { readonly ok: true; readonly data: T } | { readonly ok: false },
): ReadState<T> {
  return result.ok ? { ok: true, data: result.data } : FAILED;
}
