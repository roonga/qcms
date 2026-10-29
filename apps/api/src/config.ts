/**
 * No error here may echo a value (SEC-8): every issue names the offending env var and a
 * generic reason only.
 */

import { HONEYPOT_FIELD_NAME } from "@roonga/qcms-a2ui-compiler";
import { environmentDatabaseUrlVariableName } from "@roonga/qcms-db/environment";

import { PROD_ENVIRONMENT } from "./environments.js";
import {
  DEFAULT_OUTBOX_PAYLOAD_RETENTION_MS,
  DEFAULT_RESPONSE_SNIPPET_RETENTION_MS,
} from "@roonga/qcms-db";
import { z } from "zod";

// Characters, not bytes: the check below compares `raw.length`, which counts UTF-16 code
// units. SEC-4/SEC-7 ask for >= 32 random bytes, and a non-ASCII secret of 32 characters
// exceeds that, so the unit errs safe.
export const MIN_SECRET_LENGTH = 32;
export const APP_KEY_MIN_LENGTH = 32;

/**
 * A deployment with placeholder secrets must refuse to boot (SEC-8). Matched on the
 * prefix rather than the exact example strings so the guard survives a reword.
 */
export const PLACEHOLDER_PREFIXES: readonly string[] = [
  "replace-",
  "change-me",
  "changeme",
  "your-",
  "example-",
  "placeholder",
  "<",
];

/**
 * Separators are normalised before matching, so this stays in agreement with
 * `scripts/check-security-hygiene.mjs`, which accepts underscore spellings too.
 */
function looksLikePlaceholder(raw: string): boolean {
  const value = raw.trim().toLowerCase().replaceAll("_", "-");
  return PLACEHOLDER_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** Decides only the remedy sentence; the refusal itself applies to both kinds. */
type ConfigValueKind = "secret" | "setting";

// Reports the count and the variable name only: the same path handles real values.
function rejectPlaceholders(
  name: string,
  values: readonly string[],
  issues: string[],
  kind: ConfigValueKind = "secret",
): void {
  const placeholders = values.filter((value) => looksLikePlaceholder(value)).length;
  if (placeholders === 0) return;
  const remedy =
    kind === "secret"
      ? "generate real secrets (see docs/operations.md) before booting"
      : "set the value for this deployment before booting";
  issues.push(
    `${name} still holds ${placeholders} placeholder value(s) from an example file; ${remedy}`,
  );
}

export interface RateLimitClass {
  readonly windowMs: number;
  readonly max: number;
}

/**
 * An unmounted group has no routes at all, so a request to one of its addresses is a
 * plain 404 rather than a handler's refusal (ADR-09, SEC-14).
 */
export interface MountFlags {
  readonly public: boolean;
  readonly internal: boolean;
  readonly admin: boolean;
  /**
   * Non-prod environments only; `prod` is {@link MountFlags.public}. Absent means none,
   * which is the fail-closed direction.
   */
  readonly environments?: readonly string[];
}

const MOUNT_SURFACES = ["public", "internal", "admin"] as const;
type MountSurface = (typeof MOUNT_SURFACES)[number];

/**
 * `none` leaves the assist routes unmounted; `fake` makes no network call and needs no
 * key, so CI can drive the real tool loop without a provider account.
 */
export const AGENT_PROVIDERS = [
  "none",
  "fake",
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export interface Flags {
  readonly challengeProvider: "none" | "turnstile";
  /** `optional` is the documented dev escape hatch (SEC-1). */
  readonly adminTwoFactor: "required" | "optional";
  readonly agentAuthoring: AgentProvider;
}

export interface Config {
  /** The control plane's credential (`qcms_app_control`), not the respondent path's. */
  readonly databaseUrl: string;
  /**
   * The credential for each environment is configuration, never a database read: a
   * credential the database hands out is one it can be made to hand out. A new
   * environment needs a restart, since nothing accepts a credential unvalidated at boot.
   */
  readonly environments: readonly EnvironmentConfig[];
  readonly mount: MountFlags;
  readonly portalBaseUrl: string;
  readonly webhooks: {
    /**
     * SSRF guard (SEC-6). When false, targets must be HTTPS and must not resolve to
     * private/reserved/loopback/link-local hosts. True also permits plain HTTP.
     */
    readonly allowPrivateTargets: boolean;
    readonly deliveryTimeoutMs: number;
    readonly deliveryBatchSize: number;
  };
  readonly keys: {
    /** First signs, all verify. */
    readonly link: readonly string[];
    /** First signs, all verify. */
    readonly session: readonly string[];
    /** Any entry matches, so a token can be rotated without a flag day. */
    readonly internal: readonly string[];
    readonly app: string;
  };
  readonly ttl: {
    readonly anonymousSessionMs: number;
    /** `0` is legitimate and means "at the next sweep": strict data minimisation. */
    readonly deliveryResponseSnippetMs: number;
    /**
     * The window is the redelivery window, so `0` is legitimate and trades redelivery
     * for holding no second copy of a respondent's answers.
     */
    readonly outboxPayloadMs: number;
  };
  /**
   * Each class is bucketed by its natural abuse unit: by session where one exists, and
   * by IP as a backstop against many-session floods from one source.
   */
  readonly rateLimit: {
    readonly sessionCreate: RateLimitClass;
    readonly answersPerSession: RateLimitClass;
    readonly answersPerIp: RateLimitClass;
    readonly submitPerSession: RateLimitClass;
    /**
     * Limits how fast a bounded operation may be repeated, never how large it may
     * become: the size bound is the group's author-set `max` (Q14).
     */
    readonly rosterPerSession: RateLimitClass;
    readonly rosterPerIp: RateLimitClass;
    /** The upstream agent call is the expensive, billable one. */
    readonly agentAssist: RateLimitClass;
  };
  readonly scheduler: {
    readonly outboxIntervalMs: number;
    readonly outboxJitterMs: number;
    readonly retentionSweepIntervalMs: number;
  };
  /**
   * Idle expiry is better-auth's own bookkeeping; the verifier adds the absolute cap,
   * because an idle window alone can be renewed indefinitely by a warm session (SEC-1).
   */
  readonly adminSession: {
    readonly maxAgeMs: number;
  };
  /**
   * Required iff the admin surface is mounted: a respondent-only process has no identity
   * provider and must not be made to carry its secret.
   */
  readonly adminAuth: {
    /**
     * In the pinned better-auth 1.7.10 this is the legacy fallback: the key used to read
     * ciphertext written before the versioned envelope existed.
     */
    readonly secret: string;
    /**
     * First entry is current and is what new ciphertext is written under; the rest are
     * decrypt-only, so ciphertext under a retired key can still be read.
     */
    readonly secrets: readonly { readonly version: number; readonly value: string }[];
    /**
     * The admin app's public origin, not this API's: better-auth is reached through the
     * admin's BFF, so its cookies belong to the browser-facing origin.
     */
    readonly baseUrl: string;
    readonly idleMs: number;
    /**
     * A knob rather than only an inference from `NODE_ENV`, because it has to describe
     * the browser-facing origin's scheme, which this process cannot see.
     */
    readonly secureCookies: boolean;
    /**
     * Setting it false is a documented downgrade against NIST SP 800-63B Rev 4 section
     * 3.1.1.2 and OWASP ASVS 5.0 6.2.12, for a structurally offline deployment. A
     * config-plane decision a reviewer reads, never a runtime bypass (SEC-1).
     */
    readonly breachedPasswordCheck: boolean;
    /**
     * Passed through to better-auth explicitly because its own default resolves from
     * `NODE_ENV`, which must not decide a security control. False serves an unlimited
     * admin sign-in, change-password and two-factor surface (SEC-1).
     */
    readonly signInThrottle: boolean;
  };
  readonly readiness: {
    readonly dbTimeoutMs: number;
  };
  readonly bodyLimitBytes: number;
  /**
   * Both signals are silent: a trigger flags the submission and withholds its webhook
   * event while returning the same success-shaped response, so the tells never leak.
   */
  readonly antiAbuse: {
    /** `0` disables the global check; a form's own `min_submit_ms` overrides it. */
    readonly minSubmitMs: number;
    /**
     * The compiler/API contract. Overridable only for operators who also change the
     * compiler constant; the default keeps both sides in lockstep.
     */
    readonly honeypotField: string;
  };
  readonly flags: Flags;
  readonly challenge:
    | { readonly provider: "none" }
    | {
        readonly provider: "turnstile";
        readonly turnstile: { readonly siteKey: string; readonly secretKey: string };
      };
  /**
   * A discriminated union so the provider key exists only in the enabled arm: a `none`
   * deployment has no field that could hold a secret. `apiKey` is never logged, never
   * echoed in a config error, and leaves this process only as an upstream
   * `Authorization` header built inside the provider package (SEC-7, SEC-8).
   */
  readonly agent:
    | { readonly provider: "none" }
    | {
        readonly provider: Exclude<AgentProvider, "none">;
        readonly model: string;
        /** Empty only for a keyless local endpoint. */
        readonly apiKey: string;
        /** Required for `openai-compatible`. */
        readonly baseUrl: string | undefined;
        readonly maxSteps: number;
        /** Drops every reasoning part under `off`, even one a provider emits unasked (SEC-8). */
        readonly thinking: AgentThinking;
      };
}

export const AGENT_THINKING = ["off", "summary"] as const;

export type AgentThinking = (typeof AGENT_THINKING)[number];

/** Thrown when the environment fails validation; message names vars, never values. */
export class ConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

type Env = Record<string, string | undefined>;

/**
 * Every flag is declared here and nothing else is a flag (ADR-24). Only `env` names
 * carrying the `QCMS_FLAG_` prefix participate in unknown-flag detection.
 */
interface FlagDef {
  readonly key: keyof Flags;
  readonly env: string;
  readonly schema: z.ZodType<Flags[keyof Flags]>;
  readonly fallback: Flags[keyof Flags];
  readonly description: string;
}

export const FLAG_REGISTRY: readonly FlagDef[] = [
  {
    key: "challengeProvider",
    env: "QCMS_FLAG_CHALLENGE_PROVIDER",
    schema: z.enum(["none", "turnstile"]),
    fallback: "none",
    description:
      "Abuse-control challenge provider (026). `turnstile` requires QCMS_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY.",
  },
  {
    key: "adminTwoFactor",
    env: "QCMS_ADMIN_2FA",
    schema: z.enum(["required", "optional"]),
    fallback: "required",
    description:
      "Admin TOTP 2FA policy (SEC-1). `optional` is the documented development escape hatch only.",
  },
  {
    key: "agentAuthoring",
    env: "QCMS_FLAG_AGENT_AUTHORING",
    schema: z.enum(AGENT_PROVIDERS),
    fallback: "none",
    description:
      "Agent-assisted authoring provider (041, ADR-25). `none` leaves the assist routes unmounted. " +
      "Any other value requires QCMS_AGENT_MODEL, plus QCMS_AGENT_API_KEY unless QCMS_AGENT_BASE_URL " +
      "is a local endpoint. `fake` is the deterministic test provider and calls no network.",
  },
] as const;

/**
 * The derived behaviour an admin surface may see; the provider name is a flag value and
 * never leaves the process.
 */
export function challengeEnforceable(flags: Flags): boolean {
  return flags.challengeProvider !== "none";
}

const FLAG_PREFIX = "QCMS_FLAG_";

function parseKeyList(env: Env, name: string, minLength: number, issues: string[]): string[] {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    issues.push(`${name} is required (comma-separated signing keys; first signs, all verify)`);
    return [];
  }
  const keys = raw
    .split(/[\s,]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  if (keys.length === 0) {
    issues.push(`${name} is required (no keys parsed from the value)`);
    return [];
  }
  const tooShort = keys.filter((k) => k.length < minLength).length;
  if (tooShort > 0) {
    issues.push(`${name} has ${tooShort} key(s) shorter than the ${minLength}-character minimum`);
  }
  rejectPlaceholders(name, keys, issues);
  return keys;
}

/**
 * "Newest first" because better-auth encrypts under the first entry, so an oldest-first
 * list would keep writing under the retired key. Parsed here, not by `parseSecretsEnv`,
 * whose refusals quote the offending entry (SEC-8).
 */
function parseSecretVersions(
  env: Env,
  name: string,
  current: string,
  minLength: number,
  issues: string[],
): { readonly version: number; readonly value: string }[] {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return [{ version: 1, value: current }];

  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    issues.push(`${name} is set but no <version>:<secret> entries were parsed from it`);
    return [{ version: 1, value: current }];
  }

  const parsed: { version: number; value: string }[] = [];
  const seen = new Set<number>();
  for (const [index, entry] of entries.entries()) {
    const separator = entry.indexOf(":");
    if (separator === -1) {
      issues.push(`${name} entry ${index + 1} is not in <version>:<secret> form`);
      continue;
    }
    const label = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    const version = Number(label);
    if (!Number.isInteger(version) || version < 0 || label === "") {
      issues.push(`${name} entry ${index + 1} has a version that is not a non-negative integer`);
      continue;
    }
    if (seen.has(version)) {
      issues.push(`${name} repeats version ${version}; each version must appear once`);
      continue;
    }
    if (value.length < minLength) {
      issues.push(`${name} version ${version} must be at least ${minLength} characters`);
      continue;
    }
    seen.add(version);
    parsed.push({ version, value });
  }

  if (parsed.length === 0) {
    issues.push(`${name} is set but carries no usable entry`);
    return [{ version: 1, value: current }];
  }
  pushOrderIssues(name, parsed, issues);
  rejectPlaceholders(
    name,
    parsed.map((entry) => entry.value),
    issues,
  );
  return parsed;
}

/** Its own function so the parser above stays inside the cognitive-complexity budget. */
function pushOrderIssues(
  name: string,
  parsed: readonly { readonly version: number }[],
  issues: string[],
): void {
  let previous: number | undefined;
  for (const { version } of parsed) {
    if (previous !== undefined && version >= previous) {
      issues.push(
        `${name} lists version ${version} after version ${previous}; entries must be newest first, in descending version order`,
      );
    }
    previous = version;
  }
}

function parseRequiredString(
  env: Env,
  name: string,
  minLength: number,
  issues: string[],
  kind: ConfigValueKind = "secret",
): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    issues.push(`${name} is required`);
    return "";
  }
  if (raw.length < minLength) {
    issues.push(`${name} must be at least ${minLength} characters`);
  }
  rejectPlaceholders(name, [raw], issues, kind);
  return raw;
}

function parseOptionalString(env: Env, name: string, fallback: string): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

/**
 * Trailing slashes are stripped to match `apps/admin/lib/server/config.ts`: an origin
 * comparison is string equality, so a mismatched slash would make better-auth's CSRF
 * check reject every legitimate POST.
 */
function parseRequiredHttpUrl(
  env: Env,
  name: string,
  issues: string[],
  what = "the respondent portal",
): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    issues.push(`${name} is required (absolute http(s) URL of ${what})`);
    return "";
  }
  let value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    issues.push(`${name} must be an absolute URL`);
    return value;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    issues.push(`${name} must use the http or https scheme`);
  }
  while (value.endsWith("/")) value = value.slice(0, -1);
  return value;
}

function parseBool(env: Env, name: string, fallback: boolean, issues: string[]): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  issues.push(`${name} must be a boolean (true/false)`);
  return fallback;
}

function parseInt_(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  issues: string[],
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    issues.push(`${name} must be an integer >= ${min}`);
    return fallback;
  }
  return n;
}

/**
 * `prod` is refused as a token rather than treated as a synonym for `public`, and an
 * environment the configuration does not name is an unknown surface rather than an empty
 * mount: a mount that silently served nothing is the shape SEC-14 cannot afford.
 */
function parseMount(env: Env, environmentNames: readonly string[], issues: string[]): MountFlags {
  const mountable = environmentNames.filter((name) => name !== PROD_ENVIRONMENT);
  const allowed = [...MOUNT_SURFACES, "all", ...mountable].join(", ");
  const raw = env.QCMS_MOUNT;
  if (raw === undefined || raw.trim() === "") {
    issues.push(`QCMS_MOUNT is required (comma-separated: ${allowed})`);
    return { public: false, internal: false, admin: false, environments: [] };
  }
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  if (tokens.includes("all")) {
    return { public: true, internal: true, admin: true, environments: mountable };
  }
  const flags = { public: false, internal: false, admin: false };
  const environments: string[] = [];
  for (const token of tokens) {
    if ((MOUNT_SURFACES as readonly string[]).includes(token)) {
      flags[token as MountSurface] = true;
    } else if (token === PROD_ENVIRONMENT) {
      issues.push(
        `QCMS_MOUNT names "${PROD_ENVIRONMENT}", which is not a surface: ` +
          `${PROD_ENVIRONMENT} is the unprefixed address shape and is mounted by "public" (ADR-40, Q21)`,
      );
    } else if (mountable.includes(token)) {
      if (!environments.includes(token)) environments.push(token);
    } else {
      issues.push(`QCMS_MOUNT contains an unknown surface "${token}" (allowed: ${allowed})`);
    }
  }
  if (!flags.public && !flags.internal && !flags.admin && environments.length === 0) {
    issues.push(`QCMS_MOUNT selected no surfaces`);
  }
  // In the order the configuration names them, not the order the operator typed, so a
  // mount list and an address listing read the same way everywhere.
  return {
    ...flags,
    environments: mountable.filter((name) => environments.includes(name)),
  };
}

function parseFlags(env: Env, issues: string[]): Flags {
  const known = new Set(FLAG_REGISTRY.map((f) => f.env));
  for (const name of Object.keys(env)) {
    if (name.startsWith(FLAG_PREFIX) && !known.has(name)) {
      issues.push(`${name} is not a known feature flag (ADR-24: unknown QCMS_FLAG_* fails boot)`);
    }
  }
  const result: Record<string, unknown> = {};
  for (const def of FLAG_REGISTRY) {
    const raw = env[def.env];
    if (raw === undefined || raw.trim() === "") {
      result[def.key] = def.fallback;
      continue;
    }
    const parsed = def.schema.safeParse(raw);
    if (parsed.success) {
      result[def.key] = parsed.data;
    } else {
      // Enum message would echo the value; render a value-free message instead.
      const allowed = (def.schema as z.ZodEnum<never>).options?.join?.(" | ") ?? "the allowed set";
      issues.push(`${def.env} has an invalid value (allowed: ${allowed})`);
      result[def.key] = def.fallback;
    }
  }
  return result as unknown as Flags;
}

export const TURNSTILE_SITE_KEY_VAR = "QCMS_TURNSTILE_SITE_KEY";

/** The pre-#331 spelling this process still accepts, with a boot warning. */
export const DEPRECATED_TURNSTILE_SITE_KEY_VAR = "TURNSTILE_SITE_KEY";

/**
 * The deprecated name is still accepted because a hard cutover would silently disable the
 * challenge on a deployment that set only it. Returned rather than logged, so `loadConfig`
 * stays pure.
 */
export function turnstileSiteKeyDeprecationWarning(env: Env): string | undefined {
  const canonical = env[TURNSTILE_SITE_KEY_VAR]?.trim();
  const deprecated = env[DEPRECATED_TURNSTILE_SITE_KEY_VAR]?.trim();
  if (deprecated === undefined || deprecated === "") return undefined;

  const tail = describeTurnstileOverlap(canonical, deprecated);
  return `${DEPRECATED_TURNSTILE_SITE_KEY_VAR} is deprecated (issue #331): ${tail}`;
}

function describeTurnstileOverlap(canonical: string | undefined, deprecated: string): string {
  if (canonical === undefined || canonical === "") {
    return `its value is being used; set ${TURNSTILE_SITE_KEY_VAR} instead and remove it.`;
  }
  if (canonical === deprecated) {
    return `${TURNSTILE_SITE_KEY_VAR} is set to the same value and wins; remove the deprecated one.`;
  }
  return `${TURNSTILE_SITE_KEY_VAR} is set to a DIFFERENT value and wins; remove the deprecated one.`;
}

export interface EnvironmentConfig {
  /** Matches a row in `control.environments`. */
  readonly name: string;
  /** Its own pool's connection string, connecting as `qcms_app_<env>`. */
  readonly databaseUrl: string;
}

/**
 * No hyphen and no underscore: an access-group name joins environments with hyphens and
 * `data_<env>` joins on underscores, so either would make a derived string impossible to
 * parse back.
 */
export const ENVIRONMENT_NAME_PATTERN = /^[a-z][a-z0-9]*$/;

/**
 * Re-exported rather than spelled again, so the environment command and this parser
 * cannot drift apart over a rename.
 */
export const environmentDatabaseUrlVariable = environmentDatabaseUrlVariableName;

/**
 * The names are configuration because a process cannot read `control.environments`
 * before it has a connection. The boot check compares the declaration against the
 * database.
 */
function parseEnvironments(env: Env, issues: string[]): EnvironmentConfig[] {
  const raw = (env.QCMS_ENVIRONMENTS ?? "test,prod")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (raw.length === 0) {
    issues.push("QCMS_ENVIRONMENTS must name at least one environment");
    return [];
  }
  const parsed: EnvironmentConfig[] = [];
  for (const name of raw) {
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
      issues.push(
        `QCMS_ENVIRONMENTS: ${name} is not a valid environment name ` +
          "(lowercase letters and digits, starting with a letter, no hyphen or underscore)",
      );
      continue;
    }
    const variable = environmentDatabaseUrlVariable(name);
    const databaseUrl = env[variable];
    if (databaseUrl === undefined || databaseUrl.trim() === "") {
      issues.push(`${variable} is required: environment ${name} has no connection string`);
      continue;
    }
    parsed.push({ name, databaseUrl });
  }
  return parsed;
}

function parseChallenge(env: Env, flags: Flags, issues: string[]): Config["challenge"] {
  if (flags.challengeProvider === "turnstile") {
    const canonicalSiteKey = env[TURNSTILE_SITE_KEY_VAR];
    const siteKey =
      canonicalSiteKey !== undefined && canonicalSiteKey.trim() !== ""
        ? canonicalSiteKey
        : env[DEPRECATED_TURNSTILE_SITE_KEY_VAR];
    const secretKey = env.TURNSTILE_SECRET_KEY;
    if (!siteKey || siteKey.trim() === "") {
      // Names the canonical variable only: offering both spellings would re-teach the
      // ambiguity this removed.
      issues.push(
        `${TURNSTILE_SITE_KEY_VAR} is required when QCMS_FLAG_CHALLENGE_PROVIDER=turnstile`,
      );
    }
    if (!secretKey || secretKey.trim() === "") {
      issues.push(`TURNSTILE_SECRET_KEY is required when QCMS_FLAG_CHALLENGE_PROVIDER=turnstile`);
    }
    return {
      provider: "turnstile",
      turnstile: { siteKey: siteKey ?? "", secretKey: secretKey ?? "" },
    };
  }
  return { provider: "none" };
}

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
  "host.docker.internal",
]);

const LOCAL_HOST_SUFFIXES = [".local", ".localhost", ".internal"] as const;

/** Loopback or RFC 1918 private ranges. */
function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) return false;
    for (const ch of part) {
      if (ch < "0" || ch > "9") return false;
    }
    const n = Number(part);
    if (n > 255) return false;
    octets.push(n);
  }
  const [a, b] = octets as [number, number, number, number];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  return a === 172 && b >= 16 && b <= 31;
}

/**
 * The one place the "key optional" relaxation is decided, and it turns on where the
 * payload goes: anything leaving the machine or the private network still requires
 * `QCMS_AGENT_API_KEY`.
 */
export function isLocalAgentEndpoint(baseUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(hostname)) return true;
  if (LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;
  return isPrivateIpv4(hostname);
}

/** Fail-fast; the issue names the variable and its values, never the supplied value (SEC-8). */
function parseAgentThinking(env: Env, issues: string[]): AgentThinking {
  const raw = env.QCMS_AGENT_THINKING;
  if (raw === undefined || raw.trim() === "") return "off";
  const value = raw.trim();
  const known = AGENT_THINKING.find((candidate) => candidate === value);
  if (known === undefined) {
    issues.push(`QCMS_AGENT_THINKING must be one of: ${AGENT_THINKING.join(", ")}`);
    return "off";
  }
  return known;
}

/** Secrets exist only in the enabled arm; every issue names an env var, never a value (SEC-8). */
function parseAgent(env: Env, flags: Flags, issues: string[]): Config["agent"] {
  const provider = flags.agentAuthoring;
  if (provider === "none") return { provider: "none" };

  const maxSteps = parseInt_(env, "QCMS_AGENT_MAX_STEPS", DEFAULTS.agentMaxSteps, 1, issues);
  const thinking = parseAgentThinking(env, issues);

  // The test provider talks to nothing, so requiring a key would make the CI
  // composition carry a credential-shaped value for no reason.
  if (provider === "fake") {
    return {
      provider,
      model: parseOptionalString(env, "QCMS_AGENT_MODEL", "qcms-fake-assistant"),
      apiKey: "",
      baseUrl: undefined,
      maxSteps,
      thinking,
    };
  }

  const model = env.QCMS_AGENT_MODEL;
  if (model === undefined || model.trim() === "") {
    issues.push(`QCMS_AGENT_MODEL is required when QCMS_FLAG_AGENT_AUTHORING=${provider}`);
  }

  const rawBaseUrl = env.QCMS_AGENT_BASE_URL;
  let baseUrl: string | undefined;
  if (rawBaseUrl !== undefined && rawBaseUrl.trim() !== "") {
    baseUrl = parseRequiredHttpUrl(env, "QCMS_AGENT_BASE_URL", issues, "the model endpoint");
  } else if (provider === "openai-compatible") {
    issues.push(
      `QCMS_AGENT_BASE_URL is required when QCMS_FLAG_AGENT_AUTHORING=openai-compatible ` +
        `(absolute http(s) URL of the OpenAI-compatible endpoint)`,
    );
  }

  const apiKey = env.QCMS_AGENT_API_KEY;
  const keyless = baseUrl !== undefined && isLocalAgentEndpoint(baseUrl);
  if ((apiKey === undefined || apiKey.trim() === "") && !keyless) {
    issues.push(
      `QCMS_AGENT_API_KEY is required when QCMS_FLAG_AGENT_AUTHORING=${provider} ` +
        `(optional only when QCMS_AGENT_BASE_URL names a local endpoint)`,
    );
  }

  return {
    provider,
    model: model?.trim() ?? "",
    apiKey: apiKey?.trim() ?? "",
    baseUrl,
    maxSteps,
    thinking,
  };
}

const DEFAULTS = {
  anonymousSessionMs: 24 * 60 * 60 * 1000,
  // From @roonga/qcms-db, where the window's rationale lives with the sweep.
  deliveryResponseSnippetMs: DEFAULT_RESPONSE_SNIPPET_RETENTION_MS,
  outboxPayloadMs: DEFAULT_OUTBOX_PAYLOAD_RETENTION_MS,
  rlSessionCreate: { windowMs: 60 * 60 * 1000, max: 20 },
  rlAnswersPerSession: { windowMs: 5_000, max: 10 },
  rlAnswersPerIp: { windowMs: 60_000, max: 300 },
  rlSubmitPerSession: { windowMs: 60_000, max: 5 },
  // The answer write's shape rather than the submit's: a roster Add or Remove is a
  // gesture a respondent repeats many times, so sustained-plus-burst is the right model.
  rlRosterPerSession: { windowMs: 5_000, max: 10 },
  rlRosterPerIp: { windowMs: 60_000, max: 300 },
  rlAgentAssist: { windowMs: 60_000, max: 10 },
  agentMaxSteps: 8,
  outboxIntervalMs: 5_000,
  outboxJitterMs: 1_000,
  retentionSweepIntervalMs: 60 * 60 * 1000,
  readyDbTimeoutMs: 2_000,
  adminSessionMaxAgeMs: 12 * 60 * 60 * 1000, // SEC-1
  adminSessionIdleMs: 60 * 60 * 1000, // SEC-1
  webhookTimeoutMs: 10_000,
  webhookBatchSize: 20,
  bodyLimitBytes: 1_000_000, // SEC-9
  antiAbuseMinSubmitMs: 0,
  antiAbuseHoneypotField: HONEYPOT_FIELD_NAME,
} as const;

function parseRateClass(
  env: Env,
  prefix: string,
  fallback: RateLimitClass,
  issues: string[],
): RateLimitClass {
  return {
    windowMs: parseInt_(env, `${prefix}_WINDOW_MS`, fallback.windowMs, 1, issues),
    max: parseInt_(env, `${prefix}_MAX`, fallback.max, 1, issues),
  };
}

/**
 * Appended to `issues` rather than thrown for, so one boot reports every problem at
 * once. Exported because the bootstrap CLI needs this slice alone.
 */
export function parseAdminAuth(env: Env, issues: string[]): Config["adminAuth"] {
  const secret = parseRequiredString(env, "QCMS_ADMIN_AUTH_SECRET", MIN_SECRET_LENGTH, issues);
  return {
    secret,
    secrets: parseSecretVersions(env, "QCMS_ADMIN_AUTH_SECRETS", secret, MIN_SECRET_LENGTH, issues),
    baseUrl: parseRequiredHttpUrl(env, "QCMS_ADMIN_BASE_URL", issues, "the authoring admin app"),
    idleMs: parseInt_(
      env,
      "QCMS_ADMIN_SESSION_IDLE_MS",
      DEFAULTS.adminSessionIdleMs,
      1_000,
      issues,
    ),
    // `assertSecureCookiesConfigured`'s downgrade refusal is deliberately NOT enforced here:
    // safe only because browsers reach better-auth solely through the admin BFF, which refuses.
    // (issue #402) check-comments: allow read by scripts/check-bff-config-guards.test.ts
    secureCookies: parseBool(
      env,
      "QCMS_ADMIN_SECURE_COOKIES",
      env.NODE_ENV === "production",
      issues,
    ),
    // True in every environment, including development: a control the standards write as
    // SHALL is not something a developer opts into.
    breachedPasswordCheck: parseBool(env, "QCMS_ADMIN_PASSWORD_BREACH_CHECK", true, issues),
    // Deliberately does not read `NODE_ENV`: that variable must not decide a security
    // control, so an operator who configures nothing is throttled (SEC-1).
    signInThrottle: parseBool(env, "QCMS_ADMIN_SIGNIN_THROTTLE", true, issues),
  };
}

/**
 * Narrower than {@link loadAdminAuthConfig} on purpose: the break-glass exists for a
 * deployment that has lost `QCMS_ADMIN_AUTH_SECRET`, so requiring it would gate the
 * recovery on the thing that broke.
 */
export function loadResetTwoFactorConfig(env: Env): { readonly databaseUrl: string } {
  const issues: string[] = [];
  const databaseUrl = parseRequiredString(env, "DATABASE_URL", 1, issues, "setting");
  if (issues.length > 0) throw new ConfigError(issues);
  return { databaseUrl };
}

export function loadAdminAuthConfig(env: Env): {
  readonly databaseUrl: string;
  readonly adminAuth: Config["adminAuth"];
} {
  const issues: string[] = [];
  const databaseUrl = parseRequiredString(env, "DATABASE_URL", 1, issues, "setting");
  const adminAuth = parseAdminAuth(env, issues);
  if (issues.length > 0) throw new ConfigError(issues);
  return { databaseUrl, adminAuth };
}

/**
 * Nothing reads these: no better-auth instance is built where the admin surface is
 * unmounted. They exist so `Config` stays a total record.
 */
const UNMOUNTED_ADMIN_AUTH: Config["adminAuth"] = {
  secret: "",
  secrets: [],
  baseUrl: "",
  idleMs: 0,
  secureCookies: false,
  // True rather than false even though nothing reads it: an inert record that says
  // "breach checking off" is the wrong thing to find in a debug dump.
  breachedPasswordCheck: true,
  signInThrottle: true,
};

/** Collects all issues before throwing, so one boot surfaces every misconfiguration. */
export function loadConfig(env: Env): Config {
  const issues: string[] = [];

  const databaseUrl = parseRequiredString(env, "DATABASE_URL", 1, issues, "setting");
  const environments = parseEnvironments(env, issues);
  // Without `prod` a configuration has no surface to serve the unprefixed addresses from.
  if (
    environments.length > 0 &&
    !environments.some((environment) => environment.name === PROD_ENVIRONMENT)
  ) {
    issues.push(
      `QCMS_ENVIRONMENTS must include ${PROD_ENVIRONMENT}: it is the unprefixed ` +
        "address shape every prod respondent reaches, and the environment an admin request " +
        "that names none is served from (ADR-40, Q21)",
    );
  }
  const mount = parseMount(
    env,
    environments.map((environment) => environment.name),
    issues,
  );
  const link = parseKeyList(env, "QCMS_LINK_KEYS", MIN_SECRET_LENGTH, issues);
  const session = parseKeyList(env, "QCMS_SESSION_KEYS", MIN_SECRET_LENGTH, issues);
  const internal = parseKeyList(env, "QCMS_INTERNAL_TOKEN", MIN_SECRET_LENGTH, issues);
  const app = parseRequiredString(env, "QCMS_APP_KEY", APP_KEY_MIN_LENGTH, issues);
  const portalBaseUrl = parseRequiredHttpUrl(env, "QCMS_PORTAL_BASE_URL", issues);
  const allowPrivateTargets = parseBool(env, "QCMS_WEBHOOK_ALLOW_PRIVATE", false, issues);
  const flags = parseFlags(env, issues);
  const challenge = parseChallenge(env, flags, issues);
  const agent = parseAgent(env, flags, issues);

  const config: Config = {
    databaseUrl,
    environments,
    mount,
    portalBaseUrl,
    webhooks: {
      allowPrivateTargets,
      deliveryTimeoutMs: parseInt_(
        env,
        "QCMS_WEBHOOK_TIMEOUT_MS",
        DEFAULTS.webhookTimeoutMs,
        100,
        issues,
      ),
      deliveryBatchSize: parseInt_(
        env,
        "QCMS_WEBHOOK_BATCH_SIZE",
        DEFAULTS.webhookBatchSize,
        1,
        issues,
      ),
    },
    keys: { link, session, internal, app },
    ttl: {
      anonymousSessionMs: parseInt_(
        env,
        "QCMS_SESSION_TTL_MS",
        DEFAULTS.anonymousSessionMs,
        1_000,
        issues,
      ),
      deliveryResponseSnippetMs: parseInt_(
        env,
        "QCMS_DELIVERY_SNIPPET_TTL_MS",
        DEFAULTS.deliveryResponseSnippetMs,
        // Floor of 0, not 1_000: there is no lower bound below which keeping less of a
        // consumer's response body becomes wrong.
        0,
        issues,
      ),
      outboxPayloadMs: parseInt_(
        env,
        "QCMS_OUTBOX_PAYLOAD_TTL_MS",
        DEFAULTS.outboxPayloadMs,
        // Floor of 0 for the same reason as the snippet above.
        0,
        issues,
      ),
    },
    rateLimit: {
      sessionCreate: parseRateClass(
        env,
        "QCMS_RL_SESSION_CREATE",
        DEFAULTS.rlSessionCreate,
        issues,
      ),
      answersPerSession: parseRateClass(
        env,
        "QCMS_RL_ANSWERS_SESSION",
        DEFAULTS.rlAnswersPerSession,
        issues,
      ),
      answersPerIp: parseRateClass(env, "QCMS_RL_ANSWERS_IP", DEFAULTS.rlAnswersPerIp, issues),
      submitPerSession: parseRateClass(
        env,
        "QCMS_RL_SUBMIT_SESSION",
        DEFAULTS.rlSubmitPerSession,
        issues,
      ),
      rosterPerSession: parseRateClass(
        env,
        "QCMS_RL_ROSTER_SESSION",
        DEFAULTS.rlRosterPerSession,
        issues,
      ),
      rosterPerIp: parseRateClass(env, "QCMS_RL_ROSTER_IP", DEFAULTS.rlRosterPerIp, issues),
      agentAssist: parseRateClass(env, "QCMS_RL_AGENT_ASSIST", DEFAULTS.rlAgentAssist, issues),
    },
    scheduler: {
      outboxIntervalMs: parseInt_(
        env,
        "QCMS_OUTBOX_INTERVAL_MS",
        DEFAULTS.outboxIntervalMs,
        100,
        issues,
      ),
      outboxJitterMs: parseInt_(env, "QCMS_OUTBOX_JITTER_MS", DEFAULTS.outboxJitterMs, 0, issues),
      retentionSweepIntervalMs: parseInt_(
        env,
        "QCMS_RETENTION_SWEEP_INTERVAL_MS",
        DEFAULTS.retentionSweepIntervalMs,
        1_000,
        issues,
      ),
    },
    adminSession: {
      maxAgeMs: parseInt_(
        env,
        "QCMS_ADMIN_SESSION_MAX_AGE_MS",
        DEFAULTS.adminSessionMaxAgeMs,
        1_000,
        issues,
      ),
    },
    adminAuth: mount.admin ? parseAdminAuth(env, issues) : UNMOUNTED_ADMIN_AUTH,
    readiness: {
      dbTimeoutMs: parseInt_(env, "QCMS_READY_DB_TIMEOUT_MS", DEFAULTS.readyDbTimeoutMs, 1, issues),
    },
    bodyLimitBytes: parseInt_(env, "QCMS_BODY_LIMIT_BYTES", DEFAULTS.bodyLimitBytes, 1, issues),
    antiAbuse: {
      minSubmitMs: parseInt_(
        env,
        "QCMS_ANTIABUSE_MIN_SUBMIT_MS",
        DEFAULTS.antiAbuseMinSubmitMs,
        0,
        issues,
      ),
      honeypotField: parseOptionalString(
        env,
        "QCMS_ANTIABUSE_HONEYPOT_FIELD",
        DEFAULTS.antiAbuseHoneypotField,
      ),
    },
    flags,
    challenge,
    agent,
  };

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }
  return config;
}
