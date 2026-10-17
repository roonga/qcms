/**
 * Masking an endpoint URL's query string for a `forms.viewer` (Q58, Code Owner,
 * 2026-09-30; task 067).
 *
 * # What the ruling says, and what it deliberately does not
 *
 * A **`forms.viewer`** sees an endpoint's **scheme, host and path**, with the query string
 * masked; a **`forms.editor` and above** sees the whole URL. Two things are stated rather
 * than left to an implementer, and the second is the one that keeps this module honest:
 *
 *   - the **URL is not treated as a secret and the signing secret is**. The secret has
 *     never left this API in a read (SEC-6): it is encrypted at rest and returned exactly
 *     once, at the create or the rotate that produced it. Nothing here changes that, and
 *     nothing here should be read as making the URL a second secret.
 *   - **masking a query string is a mitigation and not a control.** An operator who puts
 *     a credential in an endpoint URL has put a credential somewhere this product cannot
 *     protect it: it is in the database, in the deliverer's logs' request target where
 *     one exists, and on the consumer's side of the wire. So `docs/webhooks.md` and
 *     `docs/operations.md` carry the instruction not to do it, and this module is what
 *     narrows the blast radius for the deployment that did it anyway.
 *
 * # Why the API masks and not the admin
 *
 * Q58: "the API does the masking, in the response it returns to that role, never the
 * admin's rendering, so a second client of the same route cannot see round it". A client
 * that is not the shipped admin - a script, a second front end, a curl - presents a
 * session token and reaches the same route, and a rendering rule would be no rule at all
 * for any of them. So the bytes that leave the process are already masked, and the admin
 * renders what it is given.
 *
 * # What is masked, and what is not
 *
 * The **query string only**. The fragment is not masked because a URL that reaches this
 * module has passed `checkWebhookUrl`, and a fragment is never sent to a server anyway;
 * userinfo (`https://user:pass@host/`) is **not** masked either, and that is deliberate
 * rather than an oversight: it is refused outright by nothing today, so masking it would
 * hide a misconfiguration an operator needs to see rather than protect anything, and the
 * documentation instruction covers it. The host and the path stay whole, which is the
 * whole point of the ruling - a `forms.viewer` is meant to be able to tell what this
 * endpoint is.
 */

/**
 * What replaces a masked query string.
 *
 * A fixed token rather than per-parameter masking, for two reasons. The parameter
 * **names** are as likely to be the interesting part as the values (`?token=`, `?key=`),
 * and a masked value beside a plain name tells a reader exactly what to go and ask for.
 * And a fixed token cannot be reversed by counting characters, which per-value masking
 * invites.
 */
export const MASKED_QUERY = "(hidden)";

/**
 * The URL as a `forms.viewer` is shown it: scheme, host and path, with any query string
 * replaced by {@link MASKED_QUERY}.
 *
 * String surgery rather than `new URL()`, for the reason
 * `apps/api/src/telemetry-redaction.ts` gives for the same job: this runs on the way out
 * of a read, and a parse failure must not be able to throw there. A stored URL has passed
 * the SSRF check and is absolute, so the first `?` is the query's start; a URL with none
 * is returned unchanged, which is the ordinary case and is what makes this safe to apply
 * to every row rather than to the ones that look interesting.
 */
export function maskEndpointUrl(url: string): string {
  const query = url.indexOf("?");
  if (query === -1) return url;
  // Anything after the query is the fragment, which a server never sees. It is dropped
  // with the query rather than preserved, because `path?(hidden)#frag` reads as though
  // the fragment were part of what was kept.
  return `${url.slice(0, query)}?${MASKED_QUERY}`;
}

/** The URL a caller with this visibility is shown. */
export function endpointUrlFor(url: string, visibility: "whole" | "masked" | undefined): string {
  // Anything other than `"whole"` masks, so a row the middleware did not classify is
  // masked rather than shown. The fail-closed direction, and the reason the context field
  // is read here rather than defaulted there.
  return visibility === "whole" ? url : maskEndpointUrl(url);
}
