/**
 * Boot configuration (task 017, SEC-7 inventory, SEC-8 secrets, ADR-24 flags).
 *
 * One place reads the environment, validates it, and fails fast. Two rules
 * dominate:
 *
 * 1. **Validate presence *and* shape.** A secret that is present but too short
 *    is a misconfiguration, caught at boot - not at first use.
 * 2. **Never echo values (SEC-8).** Every error names the offending env var and
 *    what was wrong; it never prints the value. This is a testable property
 *    (the redaction test), so `ConfigError.message` is built only from env-var
 *    names and generic reasons.
 *
 * Key-list envs (`QCMS_LINK_KEYS`, `QCMS_SESSION_KEYS`, `QCMS_INTERNAL_TOKEN`)
 * accept a comma/whitespace-separated list - the **first entry signs, all
 * entries verify** (010's rotation model). Webhook signing does *not* use a
 * global env key: per-webhook secrets are stored encrypted under
 * `QCMS_APP_KEY` (SEC-6), handled in later tasks.
 *
 * Nothing here imports `node:*`; `loadConfig` takes an env record so it is pure
 * and testable. `serve.ts` calls `loadConfig(process.env)`.
 */

import { HONEYPOT_FIELD_NAME } from "@qcms/a2ui-compiler";
import {
  DEFAULT_OUTBOX_PAYLOAD_RETENTION_MS,
  DEFAULT_RESPONSE_SNIPPET_RETENTION_MS,
} from "@qcms/db";
import { z } from "zod";

/** Minimum bytes for signing/secret material (SEC-4/SEC-7: >= 32 random bytes). */
export const MIN_SECRET_LENGTH = 32;
/** AES-256-GCM key length for `QCMS_APP_KEY` (SEC-6/SEC-8); 32 bytes = 256 bits. */
export const APP_KEY_MIN_LENGTH = 32;

/** One rate-limit class: at most `max` requests per fixed `windowMs` per key. */
export interface RateLimitClass {
  readonly windowMs: number;
  readonly max: number;
}

/** Which route groups a process mounts (ADR-09: admin does not exist in public). */
export interface MountFlags {
  readonly public: boolean;
  readonly internal: boolean;
  readonly admin: boolean;
}

const MOUNT_SURFACES = ["public", "internal", "admin"] as const;
type MountSurface = (typeof MOUNT_SURFACES)[number];

/**
 * Draft-assistant providers (041, ADR-25). The flag names the provider id, so
 * switching vendor or model is an env change plus a restart - never a code
 * change (ADR-24 semantics).
 *
 * - `none` is the default and means the assist routes are not mounted at all.
 * - `fake` is the deterministic scripted provider the test suites drive. It
 *   makes no network call and needs no key, which is what lets CI exercise the
 *   real tool loop without a provider account.
 * - `anthropic` is the documented reference. `openai` and `google` are the same
 *   code path with a different provider package.
 * - `openai-compatible` covers every OpenAI-protocol endpoint, including local
 *   runtimes (Ollama, vLLM, LM Studio, llama.cpp-server): base URL plus model
 *   name, and the key requirement relaxes for a local base URL.
 */
export const AGENT_PROVIDERS = [
  "none",
  "fake",
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
] as const;

/** A configured draft-assistant provider id (041). */
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

/** The typed feature flags (ADR-24) that reach handlers via `deps`. */
export interface Flags {
  /** Challenge provider for abuse controls (026); Turnstile secrets required iff `turnstile`. */
  readonly challengeProvider: "none" | "turnstile";
  /** Admin 2FA policy (SEC-1); `optional` is the documented dev escape hatch. */
  readonly adminTwoFactor: "required" | "optional";
  /**
   * Agent-assisted authoring provider (041, ADR-25). `none` (the default) leaves
   * the assist routes unmounted; anything else requires `QCMS_AGENT_MODEL` and,
   * unless the base URL is local, `QCMS_AGENT_API_KEY`.
   */
  readonly agentAuthoring: AgentProvider;
}

/** The validated, in-memory configuration the whole process shares. */
export interface Config {
  readonly databaseUrl: string;
  readonly mount: MountFlags;
  /**
   * Public base URL of the respondent portal (`QCMS_PORTAL_BASE_URL`), used to
   * build secure-link URLs authors copy/share (024). An absolute http(s) URL;
   * links are minted as `${portalBaseUrl}/l/<token>`.
   */
  readonly portalBaseUrl: string;
  readonly webhooks: {
    /**
     * SSRF override (`QCMS_WEBHOOK_ALLOW_PRIVATE`, default false). When false
     * (the safe default) webhook target URLs must be HTTPS and must not resolve
     * to private/reserved/loopback/link-local hosts. Set true **only** for
     * on-prem topologies that legitimately post to internal systems (SEC-6);
     * it also permits plain HTTP. Full DNS-rebinding protection is a
     * delivery-time concern (025); this is the config-time host/scheme guard.
     */
    readonly allowPrivateTargets: boolean;
    /**
     * Per-request delivery timeout in ms (`QCMS_WEBHOOK_TIMEOUT_MS`, default
     * 10_000). A webhook POST that does not respond `2xx` within this window is a
     * failed attempt (backoff + eventual dead-letter, task 025).
     */
    readonly deliveryTimeoutMs: number;
    /**
     * Max deliveries a single pass processes (`QCMS_WEBHOOK_BATCH_SIZE`, default
     * 20). Bounds the work - and the outbox/delivery row locks held - per tick;
     * the scheduler interval drains the rest.
     */
    readonly deliveryBatchSize: number;
  };
  readonly keys: {
    /** Secure-link signing keys (`QCMS_LINK_KEYS`); first signs, all verify. */
    readonly link: readonly string[];
    /** Session-token signing keys (`QCMS_SESSION_KEYS`); first signs, all verify. */
    readonly session: readonly string[];
    /** Accepted internal service tokens (`QCMS_INTERNAL_TOKEN`); any matches (rotation). */
    readonly internal: readonly string[];
    /** App encryption key (`QCMS_APP_KEY`) for at-rest secrets (SEC-6/SEC-8). */
    readonly app: string;
  };
  readonly ttl: {
    /** Anonymous session TTL in ms (`QCMS_SESSION_TTL_MS`). */
    readonly anonymousSessionMs: number;
    /**
     * How long a webhook delivery's stored response snippet is kept, measured from
     * the attempt that produced it (`QCMS_DELIVERY_SNIPPET_TTL_MS`, default 7 days -
     * issue #304). The retention sweep removes older ones.
     *
     * `0` is a legitimate setting and means "at the next sweep": an operator running
     * strict data minimisation, who would rather lose the diagnostic than hold a
     * consumer's response body at all, sets it there. The rest of the attempt record
     * is value-free and is kept whatever this is set to.
     */
    readonly deliveryResponseSnippetMs: number;
    /**
     * How long a settled outbox event keeps the `answers` member of its payload,
     * measured from the moment the event and its whole fan-out stopped moving
     * (`QCMS_OUTBOX_PAYLOAD_TTL_MS`, default 30 days - issue #329). The retention
     * sweep drops the answers and keeps the envelope.
     *
     * The window is the redelivery window: the payload exists to let an operator
     * re-send a delivery, so `0` is a legitimate setting and means "as soon as the
     * fan-out settles" - strict data minimisation at the cost of ever redelivering.
     * The event, its envelope and the whole delivery record are kept whatever this
     * is set to.
     */
    readonly outboxPayloadMs: number;
  };
  /**
   * Per-endpoint-class rate limits (task 026), each a fixed window enforced by
   * 017's pluggable store. Respondent traffic is bucketed by the natural abuse
   * unit: session creation by client IP (no session exists yet), the serving
   * loop by session (the sustained-rate + burst ceiling) *and* by IP (a wide
   * backstop against many-session floods from one source), and submit by
   * session. All are configurable; the defaults are documented on {@link
   * DEFAULTS}. Multi-instance deployments swap the store for a shared one (017).
   */
  readonly rateLimit: {
    /** `POST /sessions` - per client IP (e.g. 20/hour). */
    readonly sessionCreate: RateLimitClass;
    /** `POST /sessions/{id}/answers` - per session (≈2/s sustained, burst 10). */
    readonly answersPerSession: RateLimitClass;
    /** `POST /sessions/{id}/answers` - per client IP (a wider flood backstop). */
    readonly answersPerIp: RateLimitClass;
    /** `POST /sessions/{id}/submit` - per session (e.g. 5/min). */
    readonly submitPerSession: RateLimitClass;
    /**
     * `POST /forms/{id}/draft/assist` - per admin principal (041). A per-deployment
     * ceiling on agent turns: the upstream call is the expensive, billable one, and
     * an authenticated author is still a rate-limit subject.
     */
    readonly agentAssist: RateLimitClass;
  };
  readonly scheduler: {
    readonly outboxIntervalMs: number;
    readonly outboxJitterMs: number;
    readonly retentionSweepIntervalMs: number;
  };
  /**
   * Admin-session policy the admin-auth middleware enforces (SEC-1, task 031).
   * Idle expiry is better-auth's own bookkeeping (it maintains
   * `session.expiresAt`); what the verifier adds is the **absolute** cap, because
   * an idle window alone can be renewed indefinitely by a warm session.
   */
  readonly adminSession: {
    /**
     * Absolute session lifetime in ms measured from issue
     * (`QCMS_ADMIN_SESSION_MAX_AGE_MS`, default 12h per SEC-1). Past it every
     * admin API call 401s regardless of activity; the admin must sign in again.
     */
    readonly maxAgeMs: number;
  };
  /**
   * better-auth's own configuration (task 056, ADR-35 as amended 2026-07-31).
   *
   * The instance lives in this process now, so these are API env vars. They are
   * required **iff** the admin surface is mounted (`QCMS_MOUNT` includes `admin`
   * or `all`): a public-only respondent process has no identity provider and must
   * not be made to carry its secret.
   */
  readonly adminAuth: {
    /**
     * better-auth signing secret (`QCMS_ADMIN_AUTH_SECRET`, >= 32 chars, SEC-7).
     *
     * Passed to better-auth as `secret`, which in the pinned 1.6.26 means **the legacy
     * fallback**: the key used to read ciphertext written before the versioned
     * envelope existed. It is also the value {@link secrets} defaults to, so a
     * deployment that never rotates sees exactly the behaviour it always had.
     */
    readonly secret: string;
    /**
     * The versioned key set better-auth encrypts stored second-factor material
     * with (`QCMS_ADMIN_AUTH_SECRETS`; issue #319).
     *
     * First entry is current and is what new ciphertext is written under; the
     * rest are decrypt-only, kept so ciphertext written under a retired key can
     * still be read. Defaults to a single version-1 entry holding
     * {@link secret}, so the knob only has to appear in an environment that is
     * actually rotating.
     */
    readonly secrets: readonly { readonly version: number; readonly value: string }[];
    /**
     * The **admin app's public origin** (`QCMS_ADMIN_BASE_URL`), not this API's.
     * better-auth is reached through the admin's BFF, so the origin its cookies
     * belong to and the origin it must trust are both the browser-facing admin
     * one. Configured explicitly rather than inferred from a request header,
     * which is what the vendor's options reference recommends for a proxied
     * deployment.
     */
    readonly baseUrl: string;
    /** Idle session window in ms (`QCMS_ADMIN_SESSION_IDLE_MS`, default 1h, SEC-1). */
    readonly idleMs: number;
    /**
     * Whether cookies carry `Secure` (`QCMS_ADMIN_SECURE_COOKIES`). Defaults to
     * `NODE_ENV === "production"`, which is the rule the admin applied while it
     * owned the instance. It is a knob rather than only an inference because the
     * flag has to describe the **browser-facing** origin's scheme, and this
     * process cannot see it: a container marked production behind a plain-HTTP
     * ingress needs `false`, and nothing about `NODE_ENV` says so.
     */
    readonly secureCookies: boolean;
    /**
     * Whether every admin password is checked against the public breach corpus
     * (`QCMS_ADMIN_PASSWORD_BREACH_CHECK`, default **true**, SEC-1).
     *
     * A deployment-posture knob, not a feature flag, which is why it lives here
     * beside `secureCookies` rather than in the ADR-24 flag registry: it describes
     * whether this deployment has egress to `api.pwnedpasswords.com`, and it has to
     * be readable by `loadAdminAuthConfig` so the `qcms:create-admin` CLI and the
     * server agree without the CLI parsing the whole configuration.
     *
     * Setting it false is a documented downgrade against NIST SP 800-63B Rev 4
     * section 3.1.1.2 and OWASP ASVS 5.0 6.2.12. It exists for a structurally
     * offline deployment (and as the break-glass for rotating a leaked password
     * while the corpus is unreachable mid-incident), and it is deliberately a
     * config-plane decision an operator makes in a file a reviewer reads, never a
     * runtime bypass an attacker can reach.
     */
    readonly breachedPasswordCheck: boolean;
  };
  readonly readiness: {
    /** `/ready` DB-probe timeout in ms (`QCMS_READY_DB_TIMEOUT_MS`). */
    readonly dbTimeoutMs: number;
  };
  /** Max request body size in bytes (SEC-9), enforced by middleware. */
  readonly bodyLimitBytes: number;
  /**
   * Anti-abuse hooks wired at submit (task 020), tuned in 026. Both are silent:
   * a triggered signal flags the submission and withholds its webhook event
   * while returning the same success-shaped response, so the tells never leak.
   */
  readonly antiAbuse: {
    /**
     * Global default minimum ms between session creation and submit. A submit
     * faster than the effective floor is silently flagged `MIN_TIME`. `0`
     * disables the global check; a form may set its own floor
     * (`forms.min_submit_ms`) that overrides this default (task 026).
     */
    readonly minSubmitMs: number;
    /**
     * Honeypot field name on the submit body - the compiler↔API contract
     * (`HONEYPOT_FIELD_NAME`, `@qcms/a2ui-compiler`). A non-empty value flags the
     * submission `HONEYPOT`. A legitimate client never fills it, so the check is
     * always on. Overridable only for operators who also change the compiler
     * constant; the default keeps both sides in lockstep.
     */
    readonly honeypotField: string;
  };
  readonly flags: Flags;
  /** Challenge-provider secrets - present iff `flags.challengeProvider !== "none"`. */
  readonly challenge:
    | { readonly provider: "none" }
    | {
        readonly provider: "turnstile";
        readonly turnstile: { readonly siteKey: string; readonly secretKey: string };
      };
  /**
   * Draft-assistant configuration (041, ADR-25) - present iff
   * `flags.agentAuthoring !== "none"`. A discriminated union so the provider key
   * only exists in the enabled arm: a `none` deployment has no field that could
   * hold a secret, and boot requires no provider account.
   *
   * `apiKey` is a SEC-7 inventory secret. It is never logged, never echoed in a
   * config error, and never leaves this process except as an upstream
   * `Authorization` header built inside the provider package (SEC-8).
   */
  readonly agent:
    | { readonly provider: "none" }
    | {
        readonly provider: Exclude<AgentProvider, "none">;
        /** Model id (`QCMS_AGENT_MODEL`); meaning is the provider's, not ours. */
        readonly model: string;
        /** Provider key (`QCMS_AGENT_API_KEY`); empty only for a keyless local endpoint. */
        readonly apiKey: string;
        /** Optional endpoint override (`QCMS_AGENT_BASE_URL`); required for `openai-compatible`. */
        readonly baseUrl: string | undefined;
        /** Hard ceiling on tool-loop steps per turn (`QCMS_AGENT_MAX_STEPS`). */
        readonly maxSteps: number;
      };
}

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
 * Feature-flag registry (ADR-24). Every flag is declared here - name, env var,
 * value schema, default, description - and nothing else is a flag. `env` names
 * carrying the `QCMS_FLAG_` prefix participate in unknown-flag detection;
 * `QCMS_ADMIN_2FA` is folded in without the prefix (it predates the registry).
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
      "Abuse-control challenge provider (026). `turnstile` requires TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY.",
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

const FLAG_PREFIX = "QCMS_FLAG_";

// --- small parsing helpers (each records issues; none echoes a value) -------

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
  return keys;
}

/**
 * The versioned admin-auth key set (`QCMS_ADMIN_AUTH_SECRETS`, issue #319).
 *
 * Format is better-auth's own: comma-separated `<version>:<value>` entries, first
 * entry current. Unset (the normal case) yields a single version-1 entry holding
 * `current`, which is what makes the envelope format the default rather than
 * something a deployment has to opt into.
 *
 * "Newest first" is enforced, not merely documented: better-auth encrypts under
 * whichever entry comes first, so a list written oldest-first (`1:<old>,2:<new>`)
 * boots cleanly and then keeps writing under the *old* key, silently doing the
 * opposite of the rotation it was edited for. There is no signal anywhere else in
 * the system, so the refusal belongs at boot.
 *
 * Every issue this records names the env var and a **version number**, never a
 * value or a fragment of one (SEC-8). That is also why the parser is written here
 * rather than handing the raw string to better-auth's `parseSecretsEnv`, whose
 * refusals quote the offending entry verbatim.
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
  return parsed;
}

/**
 * Enforces the "newest first" half of {@link parseSecretVersions}'s contract.
 *
 * Its own function so the parser above stays inside the cognitive-complexity
 * budget, and because the rule is worth reading on its own: better-auth encrypts
 * under whichever entry is first, so ordering is not presentation.
 *
 * Named by version, never by value (SEC-8), like every other refusal here.
 */
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

function parseRequiredString(env: Env, name: string, minLength: number, issues: string[]): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    issues.push(`${name} is required`);
    return "";
  }
  if (raw.length < minLength) {
    issues.push(`${name} must be at least ${minLength} characters`);
  }
  return raw;
}

/** A non-secret optional string knob: trimmed value, or `fallback` when unset. */
function parseOptionalString(env: Env, name: string, fallback: string): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

/**
 * A required absolute http(s) URL knob (e.g. the portal base URL). Records an
 * issue - by env-var name only, never echoing the value - when absent or not a
 * parseable absolute http/https URL. `what` names the thing the URL points at, so
 * the message tells an operator which origin is missing.
 *
 * **Trailing slashes are stripped**, which matters more than tidiness. The admin app
 * normalizes the same values in `apps/admin/lib/server/config.ts` (`adminBaseUrl`,
 * `apiBaseUrl`), so without this a `QCMS_ADMIN_BASE_URL=https://admin.example/` would
 * give the admin `https://admin.example` and better-auth `https://admin.example/` for
 * both `baseURL` and its sole trusted origin - and an origin comparison is string
 * equality, so the CSRF check would reject every legitimate POST while cookie scoping
 * silently changed. The portal URL is normalized by the same stroke, which also fixes
 * the `//l/<token>` a trailing slash used to put in a minted secure link.
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

/** An optional boolean knob: accepts true/false/1/0/yes/no (case-insensitive). */
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

function parseMount(env: Env, issues: string[]): MountFlags {
  const raw = env.QCMS_MOUNT;
  if (raw === undefined || raw.trim() === "") {
    issues.push(`QCMS_MOUNT is required (comma-separated: ${MOUNT_SURFACES.join(", ")}, or "all")`);
    return { public: false, internal: false, admin: false };
  }
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  if (tokens.includes("all")) {
    return { public: true, internal: true, admin: true };
  }
  const flags = { public: false, internal: false, admin: false };
  for (const token of tokens) {
    if ((MOUNT_SURFACES as readonly string[]).includes(token)) {
      flags[token as MountSurface] = true;
    } else {
      issues.push(
        `QCMS_MOUNT contains an unknown surface "${token}" (allowed: ${MOUNT_SURFACES.join(", ")}, all)`,
      );
    }
  }
  if (!flags.public && !flags.internal && !flags.admin) {
    issues.push(`QCMS_MOUNT selected no surfaces`);
  }
  return flags;
}

function parseFlags(env: Env, issues: string[]): Flags {
  // Unknown QCMS_FLAG_* rejection (ADR-24: unknown flags fail boot).
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

function parseChallenge(env: Env, flags: Flags, issues: string[]): Config["challenge"] {
  if (flags.challengeProvider === "turnstile") {
    const siteKey = env.TURNSTILE_SITE_KEY;
    const secretKey = env.TURNSTILE_SECRET_KEY;
    if (!siteKey || siteKey.trim() === "") {
      issues.push(`TURNSTILE_SITE_KEY is required when QCMS_FLAG_CHALLENGE_PROVIDER=turnstile`);
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

/** Hostnames that are unambiguously this machine, whatever the DNS says. */
const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
  "host.docker.internal",
]);

/** Suffixes that only ever name a host inside the operator's own network. */
const LOCAL_HOST_SUFFIXES = [".local", ".localhost", ".internal"] as const;

/** True for a dotted-quad in a loopback or RFC 1918 private range. */
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
 * Whether an agent base URL points at a locally hosted model runtime.
 *
 * This is the one place the "key optional for local endpoints" relaxation is
 * decided (041). It is deliberately about *where the payload goes*, not about
 * whether a key happens to be set: an operator running Ollama, vLLM or LM Studio
 * beside the deployment has no key to give, and demanding a fake one would teach
 * people to put junk in a secret slot. Anything that leaves the machine or the
 * private network still requires `QCMS_AGENT_API_KEY`.
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

/**
 * Parse the draft-assistant configuration (041). Mirrors {@link parseChallenge}:
 * the secrets exist only in the enabled arm, and every issue names an env var
 * and never a value (SEC-8).
 */
function parseAgent(env: Env, flags: Flags, issues: string[]): Config["agent"] {
  const provider = flags.agentAuthoring;
  if (provider === "none") return { provider: "none" };

  const maxSteps = parseInt_(env, "QCMS_AGENT_MAX_STEPS", DEFAULTS.agentMaxSteps, 1, issues);

  // The deterministic test provider talks to nothing, so it needs neither a key
  // nor a real model id. Requiring either would make the CI composition carry a
  // credential-shaped value for no reason.
  if (provider === "fake") {
    return {
      provider,
      model: parseOptionalString(env, "QCMS_AGENT_MODEL", "qcms-fake-assistant"),
      apiKey: "",
      baseUrl: undefined,
      maxSteps,
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
  };
}

/** Sensible defaults for the tunable, non-secret knobs. */
const DEFAULTS = {
  anonymousSessionMs: 24 * 60 * 60 * 1000, // 24h (matches @qcms/db retention default)
  // 7d, from @qcms/db - the one place the window's rationale is written down (#304).
  deliveryResponseSnippetMs: DEFAULT_RESPONSE_SNIPPET_RETENTION_MS,
  // 30d, from @qcms/db - same split, the rationale lives with the sweep (#329).
  outboxPayloadMs: DEFAULT_OUTBOX_PAYLOAD_RETENTION_MS,
  // Per-class rate limits (task 026). Each pair is [windowMs, max].
  rlSessionCreate: { windowMs: 60 * 60 * 1000, max: 20 }, // 20 new sessions / hour / IP
  rlAnswersPerSession: { windowMs: 5_000, max: 10 }, // ≈2/s sustained, burst 10 / session
  rlAnswersPerIp: { windowMs: 60_000, max: 300 }, // wide per-IP flood backstop
  rlSubmitPerSession: { windowMs: 60_000, max: 5 }, // 5 submit attempts / min / session
  rlAgentAssist: { windowMs: 60_000, max: 10 }, // 10 agent turns / min / admin principal (041)
  agentMaxSteps: 8, // tool-loop steps per agent turn before the loop stops (041)
  outboxIntervalMs: 5_000,
  outboxJitterMs: 1_000,
  retentionSweepIntervalMs: 60 * 60 * 1000, // 1h
  readyDbTimeoutMs: 2_000,
  adminSessionMaxAgeMs: 12 * 60 * 60 * 1000, // 12h absolute admin session (SEC-1)
  adminSessionIdleMs: 60 * 60 * 1000, // 1h idle admin session (SEC-1)
  webhookTimeoutMs: 10_000, // 10s per delivery attempt (025)
  webhookBatchSize: 20, // deliveries processed per pass (025)
  bodyLimitBytes: 1_000_000, // 1MB (SEC-9)
  antiAbuseMinSubmitMs: 0, // global floor off by default; forms may override (min_submit_ms)
  // The decoy field name is the compiler↔API contract (single source of truth).
  antiAbuseHoneypotField: HONEYPOT_FIELD_NAME,
} as const;

/**
 * Parse one rate-limit class from its `<PREFIX>_WINDOW_MS` / `<PREFIX>_MAX` env
 * knobs, falling back to `fallback`. Both must be positive integers.
 */
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
 * better-auth's configuration (task 056), appended to `issues` rather than thrown
 * for, so one boot reports every problem at once.
 *
 * Exported because the first-run bootstrap CLI needs exactly this slice and nothing
 * else: making an operator supply link keys, session keys and an app encryption key
 * in order to create the very first account would be a config wall around a single
 * insert, and none of those values is read on that path.
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
    secureCookies: parseBool(
      env,
      "QCMS_ADMIN_SECURE_COOKIES",
      env.NODE_ENV === "production",
      issues,
    ),
    // Defaults to true in every environment, including development: a control the
    // standards write as SHALL is not something a developer opts into.
    breachedPasswordCheck: parseBool(env, "QCMS_ADMIN_PASSWORD_BREACH_CHECK", true, issues),
  };
}

/**
 * The admin-auth configuration and the database URL, validated on their own and
 * thrown for. The bootstrap CLI's whole configuration surface.
 */
export function loadAdminAuthConfig(env: Env): {
  readonly databaseUrl: string;
  readonly adminAuth: Config["adminAuth"];
} {
  const issues: string[] = [];
  const databaseUrl = parseRequiredString(env, "DATABASE_URL", 1, issues);
  const adminAuth = parseAdminAuth(env, issues);
  if (issues.length > 0) throw new ConfigError(issues);
  return { databaseUrl, adminAuth };
}

/**
 * Inert admin-auth values for a process that does not mount the admin surface. No
 * better-auth instance is built there (`createApp` skips the group entirely), so
 * nothing ever reads these; they exist so `Config` stays a total record.
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
};

/**
 * Validate an environment record into a {@link Config}, failing fast with a
 * {@link ConfigError} that lists every problem by env-var name. Collects all
 * issues before throwing so one boot surfaces every misconfiguration at once.
 */
export function loadConfig(env: Env): Config {
  const issues: string[] = [];

  const databaseUrl = parseRequiredString(env, "DATABASE_URL", 1, issues);
  const mount = parseMount(env, issues);
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
        // Floor of 0, not 1_000: "remove it at the next sweep" is a policy an
        // operator may legitimately want, and there is no lower bound below which
        // keeping less of a consumer's response body becomes wrong.
        0,
        issues,
      ),
      outboxPayloadMs: parseInt_(
        env,
        "QCMS_OUTBOX_PAYLOAD_TTL_MS",
        DEFAULTS.outboxPayloadMs,
        // Floor of 0 for the same reason as the snippet above: "drop the answers as
        // soon as the fan-out settles" is a policy an operator may legitimately
        // want, and there is no lower bound below which holding a second copy of a
        // respondent's answers for less time becomes wrong.
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
    // Required only where the identity provider is mounted (task 056).
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
