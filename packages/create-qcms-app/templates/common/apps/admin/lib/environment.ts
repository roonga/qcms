/**
 * The administrator's one global environment selection (ADR-40 Q6, task 065).
 *
 * Pure, client-safe and shared, exactly as `appearance.ts` is: the shell resolves the
 * selection during SSR, the topbar control re-applies it in the browser, and the cookie
 * name, the parser and the default have to be one definition rather than two that agree by
 * inspection.
 *
 * # Why a cookie, and not a URL segment or component state
 *
 * The selection has to be readable on the **server**, because every screen's data is read
 * there: a server component asks the API for its own environment's rows, so a choice the
 * server cannot see is a choice no screen can honour. React state cannot survive a
 * navigation, and `localStorage` is unreachable during SSR.
 *
 * It is deliberately **not** a URL segment either, though `/<env>/` is exactly what the
 * respondent surface gets (Q21, task 066). The two cases differ in who reads the address: a
 * respondent's link has to say which environment it is for, because nobody reads a database
 * row before clicking a link, while an administrator is looking at a banner on every page
 * and a switcher that names it. Putting it in the admin's path would double every admin
 * route for a value the operator can already see.
 *
 * # It is a selection, never an authority
 *
 * The API validates the name against the live set and refuses one it does not serve
 * (`middleware/request-environment.ts`), and the authorisation that will gate an
 * environment is ADR-41's access group, which arrives with tasks 068 and 069. So this
 * cookie steers a read and grants nothing: an operator who edits it by hand reaches an
 * environment the API would have let them reach anyway, or a 400.
 *
 * Presentation chrome, never a credential: no `httpOnly` (the browser writes it),
 * `SameSite=Lax`, `Secure` in production.
 */

/**
 * The unprefixed, unrestricted environment every deployment has (ADR-40).
 *
 * The default when there is no cookie, and the one environment the banner stays **off**
 * for: a banner on every screen all the time is a banner nobody reads, and `prod` is the
 * state an operator has to be told about least.
 */
export const PROD_ENVIRONMENT = "prod";

/**
 * Distinct from the portal's cookies and from `qcms-app-mode`, and named for what it holds.
 *
 * In development and in the browser harness the admin and the portal are both on
 * `localhost` at different ports, and cookies do not distinguish ports, so a name either
 * app might also want would be one cookie serving two apps.
 */
export const ENVIRONMENT_COOKIE = "qcms-environment";

/** A year, like the appearance mode: a selection is a preference, not a session. */
export const ENVIRONMENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The environment name rule of Q42: lowercase letters and digits, starting with a letter.
 *
 * Restated here rather than imported from the API, which the admin never imports from (R2).
 * It is a **shape** check and not the authority: the live set is what decides whether an
 * environment exists, and {@link parseEnvironment} takes it as an argument.
 */
const ENVIRONMENT_NAME = /^[a-z][a-z0-9]*$/;

/**
 * The selected environment, or `undefined` when the raw value names none this deployment
 * serves.
 *
 * The `undefined` return is the point, and it is the same reason `parseMode` has one: a
 * cookie holding a stale environment - one an operator dropped last week, or one from
 * another deployment on the same host - must fall through to `prod` rather than being
 * carried into a request the API will refuse on every screen. An operator whose selection
 * has gone sees production, which is the state that is always there.
 */
export function parseEnvironment(
  raw: string | undefined,
  available: readonly string[],
): string | undefined {
  if (raw === undefined || !ENVIRONMENT_NAME.test(raw)) return undefined;
  return available.includes(raw) ? raw : undefined;
}

/** The `document.cookie` assignment string for an environment selection. */
export function environmentCookie(environment: string, secure: boolean): string {
  const attributes = [
    `${ENVIRONMENT_COOKIE}=${environment}`,
    "Path=/",
    `Max-Age=${ENVIRONMENT_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

/**
 * Whether this environment is one the operator has to be reminded about on every screen.
 *
 * Everything except `prod`, derived rather than listed: an environment an operator created
 * last week is non-prod without anybody adding it here, which is the whole reason the
 * environment set is a table rather than a compiled-in pair.
 */
export function isNonProd(environment: string): boolean {
  return environment !== PROD_ENVIRONMENT;
}
