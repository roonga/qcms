import { t } from "@/lib/i18n/en";

/**
 * The one message an auth screen may show, chosen from the opaque markers a failed POST
 * redirects with (task 031; issue #805).
 *
 * Three distinguishable markers, one for each state the screen contract names (generic
 * failure, throttled, session expired) - and nothing more granular than that, because a
 * fourth marker is how enumeration gets reintroduced (SEC-1).
 *
 * ## Why this is one function rather than a line on each screen
 *
 * Sign-in owned this mapping and the 2FA screens each carried their own `error !==
 * undefined` line, which read as an equivalent abbreviation and was not one: a `429` from
 * the shared `/two-factor/*` throttle bucket (issue #482 documents its shape) reached the
 * challenge screen as the wrong-code sentence, so an operator whose code was perfectly
 * good was told to type another one and spent an attempt proving it (issue #805). The
 * marker vocabulary is a property of these screens as a set, so a screen joining the set
 * inherits it rather than re-deriving it.
 *
 * The ordering matters and is not alphabetical. `throttled` is read first because a
 * throttled request never got as far as being judged: reading `error` first would let a
 * redirect that carried both report the weaker fact.
 */
export function authFailureMessage(
  params: Readonly<Record<string, string | string[] | undefined>>,
): string | undefined {
  if (params.throttled !== undefined) return t("signIn.throttled");
  if (params.expired !== undefined) return t("signIn.expired");
  if (params.error !== undefined) return t("signIn.error");
  return undefined;
}
