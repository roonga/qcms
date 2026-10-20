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

import { t } from "./i18n/en.ts";

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

/**
 * What one request resolved its environment to (local UX list A12).
 *
 * Resolved **once**, and the one answer is what the API header carries and what the chrome
 * renders: before this, the header carried the raw cookie while the shell validated it and
 * fell back to `prod`, so a stale selection could show production while reading another
 * environment's rows.
 *
 * `unknown` is the state a failed read of the live set leaves, and it is deliberately not
 * `prod`: a screen that could not check the selection must not look like one that did.
 * `selection` is the cookie exactly as the server read it (empty for none) in both cases,
 * because it is what a tab compares against to notice that another tab has switched.
 */
export type ResolvedEnvironment =
  | {
      readonly status: "known";
      readonly environment: string;
      /** The live set, in canonical order, as the switcher offers it. */
      readonly environments: readonly string[];
      readonly selection: string;
    }
  | { readonly status: "unknown"; readonly selection: string };

/**
 * Resolve a selection against the live set, or against `undefined` when the set could not
 * be read.
 *
 * An empty set falls back to `prod` alone, which is what the shell has always offered a
 * caller holding no grant: the API answers that caller's reads with its own refusals.
 */
export function resolveEnvironment(
  raw: string | undefined,
  available: readonly string[] | undefined,
): ResolvedEnvironment {
  const selection = raw ?? "";
  if (available === undefined) return { status: "unknown", selection };
  const environments = available.length > 0 ? available : [PROD_ENVIRONMENT];
  return {
    status: "known",
    environment: parseEnvironment(raw, environments) ?? PROD_ENVIRONMENT,
    environments,
    selection,
  };
}

/**
 * The environment the API header names for this request.
 *
 * The resolved environment when there is one. When the set could not be read, the raw
 * selection (or `prod` for none) is still sent, because the API validates it and refuses
 * a name it does not serve; what changes in that state is that the chrome says the
 * environment is unknown and every environment-sensitive action refuses.
 */
export function headerEnvironment(resolved: ResolvedEnvironment): string {
  if (resolved.status === "known") return resolved.environment;
  return resolved.selection === "" ? PROD_ENVIRONMENT : resolved.selection;
}

/** The environment a screen shows, or `undefined` when it could not confirm one. */
export function shownEnvironment(resolved: ResolvedEnvironment): string | undefined {
  return resolved.status === "known" ? resolved.environment : undefined;
}

/** Whether an environment-sensitive action may run, and where. */
export type EnvironmentCheck =
  | { readonly ok: true; readonly environment: string }
  | { readonly ok: false; readonly message: string };

/**
 * Confirm an environment-sensitive action against the request's environment (A1): the
 * environment to act in, or the catalog sentence the action returns instead of acting.
 *
 * `shown` is the environment the screen displayed when it rendered the control, bound by
 * the page into the action rather than read when the action runs. The cookie is shared by
 * every tab, so a tab that rendered `prod` keeps saying `prod` after another tab switches to
 * `test`, and an action that read the cookie at run time acted in `test` under a dialog
 * naming `prod`. Refusing the difference is the whole fix: the operator is told what
 * happened and reloads, and nothing was changed in an environment they were not shown.
 *
 * Not an authority (the cookie still selects and the API still validates): a caller who
 * edits the bound value only earns a refusal or the act they could have performed anyway.
 */
export function confirmEnvironment(
  shown: string | undefined,
  current: ResolvedEnvironment,
): EnvironmentCheck {
  if (shown === undefined || current.status === "unknown") {
    return { ok: false, message: t("environment.unconfirmed") };
  }
  if (shown === current.environment) return { ok: true, environment: shown };
  return {
    ok: false,
    message: t("environment.switched", { shown, current: current.environment }),
  };
}

/**
 * The environment cookie's value in a `document.cookie` string, or `""` for none.
 *
 * The same spelling `resolveEnvironment` records as `selection`, so a tab can compare the
 * cookie with what its own page was rendered from without either side normalising.
 */
export function selectionFromCookies(cookieHeader: string): string {
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === ENVIRONMENT_COOKIE) {
      return part.slice(separator + 1).trim();
    }
  }
  return "";
}
