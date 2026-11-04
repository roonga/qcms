/** The selection cookie is presentation, never authority. Resolve names against the API live set and let the API enforce access. */

import { t } from "./i18n/en.ts";

export const PROD_ENVIRONMENT = "prod";

export const ENVIRONMENT_COOKIE = "qcms-environment";

export const ENVIRONMENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Mirror the API wire vocabulary without importing across deployables. */
const ENVIRONMENT_NAME = /^[a-z][a-z0-9]*$/;

/** Stale names fall back to prod instead of poisoning every API request. */
export function parseEnvironment(
  raw: string | undefined,
  available: readonly string[],
): string | undefined {
  if (raw === undefined || !ENVIRONMENT_NAME.test(raw)) return undefined;
  return available.includes(raw) ? raw : undefined;
}

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

export function isNonProd(environment: string): boolean {
  return environment !== PROD_ENVIRONMENT;
}

export type EnvironmentKind = "prod" | "nonprod" | "unknown";

/** Unknown must remain a third visual state shared by every environment indicator. */
export function environmentKind(environment: string | undefined): EnvironmentKind {
  if (environment === undefined || environment === "") return "unknown";
  return isNonProd(environment) ? "nonprod" : "prod";
}

/** Failed discovery is unknown, never confirmed prod. Preserve the raw selection so tabs can detect concurrent switches. */
export type ResolvedEnvironment =
  | {
      readonly status: "known";
      readonly environment: string;

      readonly environments: readonly string[];
      readonly selection: string;
    }
  | { readonly status: "unknown"; readonly selection: string };

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

/** On failed discovery, the API still validates the raw selection; chrome says unknown and sensitive actions refuse. */
export function headerEnvironment(resolved: ResolvedEnvironment): string {
  if (resolved.status === "known") return resolved.environment;
  return resolved.selection === "" ? PROD_ENVIRONMENT : resolved.selection;
}

export function shownEnvironment(resolved: ResolvedEnvironment): string | undefined {
  return resolved.status === "known" ? resolved.environment : undefined;
}

export type EnvironmentCheck =
  | { readonly ok: true; readonly environment: string }
  | { readonly ok: false; readonly message: string };

/** Compare the page-bound shown environment with the current request before acting. A switch in another tab must not silently retarget a destructive action. */
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
