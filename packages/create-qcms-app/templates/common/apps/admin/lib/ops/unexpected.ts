import { t } from "../i18n/en.ts";

/**
 * The sentence for a server action that **rejected** rather than returning a state.
 *
 * ## Why this exists at all
 *
 * `adminApiFetch` documents that it does not throw for a non-2xx, and that is true -
 * which is exactly what makes it a trap. A request that never gets a response still
 * rejects (`fetch` throws a `TypeError` on a transport failure), and `readResult`'s
 * `response.json()` rejects on a truncated or non-JSON body. Neither is a status this
 * app can read, so neither reaches the `ApiResult` failure shape every screen renders.
 *
 * Before this, four operator actions in this task handled the returned failure and
 * silently dropped the rejected one: the promise rejected unhandled, no state was set,
 * and the dialog stayed open looking like a slow network. On the erasure dialog that
 * is worse than a wrong message - the operator cannot tell whether an irreversible
 * ADR-17 action ran.
 *
 * ## What it does and does not say
 *
 * It renders one catalog sentence and **never** the thrown value, which is why it
 * takes no argument at all: an error from this layer can carry a URL, a header, or a
 * fragment of a body, and none of that belongs on an operator's screen or in a React
 * payload (SEC-8, SEC-13). Taking the value and ignoring it would only invite a later
 * edit to interpolate it, so the signature makes that impossible rather than
 * discouraged.
 */
export function unexpected(): string {
  return t("ops.error.unexpected");
}
