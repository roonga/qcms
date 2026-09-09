import { z } from "zod";

// Relative, not the `@/` alias: this module is loaded directly by Vitest
// (`appearance-form.test.ts`), which does not resolve the Next.js path alias, and
// every other module under `lib/` imports its siblings the same way.
import {
  APPEARANCE_MODES,
  APPEARANCE_ROUTE,
  DENSITY_LEVELS,
  type AppearanceChoice,
} from "../appearance";

/**
 * The two decisions the no-JS appearance route makes about respondent input (issue
 * #195): what the posted values are allowed to be, and where the redirect afterwards
 * is allowed to point.
 *
 * Split out of `app/appearance/route.ts` for the reason `lib/server/step-form.ts` is
 * split out of the no-JS step route: the route's own job is proxy-and-redirect duty
 * (R2), and both of these are pure functions over hostile strings, which is the kind
 * of thing that should be provable at a unit test rather than only through a browser.
 * `appearance-form.test.ts` is that proof.
 *
 * Neither function reads the environment or a cookie. The offered font list is passed
 * in, because which faces a deployment offers is config (`./theme.ts`) and a validator
 * that reached for it would be untestable without stubbing the environment.
 */

/** Where a submission with no usable return target goes. */
export const DEFAULT_RETURN = "/";

/**
 * The origin every candidate return target is resolved against.
 *
 * A synthetic host rather than `portalBaseUrl()`, and that is the point rather than a
 * shortcut. The only property being checked is "does this string stay inside our own
 * origin", and a relative reference either does or does not, whatever the origin is:
 * `//evil.example` and `/\evil.example` both resolve to a DIFFERENT origin than
 * whatever base they are given (the URL parser treats a backslash as a slash for
 * special schemes, so the second is the first in disguise), while `/s/ses_1` resolves
 * to the base itself. Using a constant here means the check cannot be defeated by an
 * unset or mis-set `QCMS_PORTAL_BASE_URL`, and cannot silently start passing
 * everything if that variable is ever read as an empty string.
 *
 * `.invalid` is the reserved TLD (RFC 2606), so this can never name a real host.
 */
const PROBE_ORIGIN = "https://portal.invalid";

/**
 * An encoded slash or backslash anywhere in the candidate.
 *
 * No path this portal serves contains one, and both are separator characters wearing a
 * disguise: `%2F%2Fevil.example` survives URL parsing intact (percent-encoded slashes are
 * deliberately NOT decoded during path normalisation) and would be handed on as a path
 * whose meaning depends on what decodes it next. Refused rather than reasoned about.
 */
const ENCODED_SEPARATOR = /%2f|%5c/iu;

/**
 * A validated same-origin path to redirect a respondent back to, or `undefined`.
 *
 * Accepts a relative reference only, and then only one that resolves inside this
 * origin. Every rejection lands on the same answer, so an attacker learns nothing by
 * probing: an absolute URL, a protocol-relative `//host`, its backslash spelling, a
 * `javascript:` string and a fragment-only reference are all simply "no target".
 *
 * ## The check that is easy to get wrong, and was (PR #859 review)
 *
 * Checking the CANDIDATE for a leading `//` is not enough, because URL parsing rewrites
 * the string before anyone reads it. Dot-segment normalisation resolves `/..//evil.example`
 * to the pathname `//evil.example`: a single leading slash goes in and a protocol-relative
 * reference comes out. It has three spellings that all land there - `/..//host`,
 * `/x/..//host`, and `/%2e%2e//host`, because the parser decodes `%2e` as a dot segment -
 * and a backslash is a slash to the parser for a special scheme, so `/..\host` is a fourth.
 * The origin check passes on every one of them, since the resolution happened inside the
 * probe origin; what escapes is the RESULT, once a browser resolves it as a `Location`.
 *
 * So the leading-`//` test is applied to the parser's own output, after normalisation, and
 * a backslash or an encoded separator anywhere in the candidate is refused outright. The
 * route then emits the target as an ABSOLUTE URL on the portal's own origin, so even a
 * bypass of everything above could not produce a Location that leaves this deployment.
 * Two independent controls, because this one is a string check and string checks are where
 * this class of defect lives.
 *
 * The route itself is refused as a target too. It is same-origin and would pass every
 * other rule, but it exports `POST` only, so redirecting there hands the respondent a
 * 405 instead of the page they were reading.
 *
 * The hash is dropped rather than carried. It never reaches a server, so preserving it
 * would only widen what this function has to reason about.
 */
function internalPath(candidate: string | undefined): string | undefined {
  if (candidate === undefined || !candidate.startsWith("/")) return undefined;
  if (candidate.includes("\\") || ENCODED_SEPARATOR.test(candidate)) return undefined;
  let resolved: URL;
  try {
    resolved = new URL(candidate, PROBE_ORIGIN);
  } catch {
    return undefined;
  }
  if (resolved.origin !== PROBE_ORIGIN) return undefined;
  // After normalisation, not before: this is the dot-segment escape above.
  if (resolved.pathname.startsWith("//")) return undefined;
  if (resolved.pathname === APPEARANCE_ROUTE) return undefined;
  return `${resolved.pathname}${resolved.search}`;
}

/** The path of a `Referer` that names this portal's own origin, or `undefined`. */
function refererPath(referer: string | undefined, baseUrl: string | undefined): string | undefined {
  if (referer === undefined || baseUrl === undefined) return undefined;
  let expected: string;
  let sent: URL;
  try {
    expected = new URL(baseUrl).origin;
    sent = new URL(referer);
  } catch {
    return undefined;
  }
  if (sent.origin !== expected) return undefined;
  return internalPath(`${sent.pathname}${sent.search}`);
}

/**
 * Where the appearance form's 303 points: the page the respondent submitted it from.
 *
 * Precedence is the hidden field, then the `Referer`, then the site root, and the
 * order is not arbitrary. **The portal sends `Referrer-Policy: no-referrer` on every
 * response (`proxy.ts`), so on this deployment the header is simply absent** - a form
 * navigation carries no `Referer` at all, which is also why the same policy makes
 * `Origin: null` the shape the CSRF belt has to reason about
 * (`lib/server/origin-belt-log.ts`). The hidden field is therefore what actually
 * carries the return target here, and the header leg exists for a deployment that
 * relaxes that policy at its own ingress. Both are respondent-controllable strings and
 * both go through the same check, so which one supplied the value changes nothing
 * about what is allowed.
 *
 * Total: there is always an answer, and the worst case is the site root.
 */
export function safeReturnPath(
  candidate: string | undefined,
  referer: string | undefined,
  baseUrl: string | undefined,
): string {
  return internalPath(candidate) ?? refererPath(referer, baseUrl) ?? DEFAULT_RETURN;
}

/**
 * The posted appearance values, or `{}` when they are not exactly what the form emits.
 *
 * Precisely: an ABSENT axis is simply not written (each member is `.optional()`, and a
 * submission that omits one is asking for nothing on that axis, not for a reset). A
 * PRESENT axis carrying anything outside its enumeration fails the whole object, so no
 * axis is written at all.
 *
 * Rejecting whole rather than dropping the offending axis, because the only thing that
 * produces this form is the portal's own markup and it always posts all three: a radio
 * group always has a checked member and a `<select>` always has a value. So a submission
 * with a bad value in it was hand-built, and applying the half of it that happened to
 * parse would be honouring a request nobody made. The respondent still gets their page
 * back (the route redirects either way); they just get it unchanged.
 *
 * Mode and density are closed enumerations from `lib/appearance.ts`. **Font is not**:
 * which faces exist is the `@roonga/qcms-ui` registry and which of them a deployment
 * OFFERS is `QCMS_PORTAL_FONTS`, so the enumeration is built per request from the
 * offered keys. Validating against the registry instead would let a respondent pin a
 * face their deployment curated away, which is the same reasoning `resolveAppearance`
 * already applies when it reads the cookie back.
 */
export function parseAppearanceChoice(
  form: FormData,
  offeredFonts: readonly string[],
): AppearanceChoice {
  const parsed = choiceSchema(offeredFonts).safeParse({
    mode: field(form, "mode"),
    font: field(form, "font"),
    density: field(form, "density"),
  });
  return parsed.success ? parsed.data : {};
}

/** One form field as a string, or `undefined` for an absent field or an uploaded file. */
function field(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * The schema for one submission. Built per call because the font enumeration depends
 * on the deployment's offered list.
 *
 * `z.enum` needs at least one member. `portalFontChoices()` always contains System, so
 * the empty case is unreachable in the app; `z.never()` is the honest schema for it
 * anyway, and it fails closed (no font is acceptable) rather than open.
 */
function choiceSchema(offeredFonts: readonly string[]) {
  const font =
    offeredFonts.length > 0 ? z.enum([...offeredFonts] as [string, ...string[]]) : z.never();
  return z.object({
    mode: z.enum(APPEARANCE_MODES).optional(),
    font: font.optional(),
    density: z.enum(DENSITY_LEVELS).optional(),
  });
}
