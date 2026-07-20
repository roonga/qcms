/**
 * Boot configuration (task 017, SEC-7 inventory, SEC-8 secrets, ADR-24 flags).
 *
 * One place reads the environment, validates it, and fails fast. Two rules
 * dominate:
 *
 * 1. **Validate presence *and* shape.** A secret that is present but too short
 *    is a misconfiguration, caught at boot — not at first use.
 * 2. **Never echo values (SEC-8).** Every error names the offending env var and
 *    what was wrong; it never prints the value. This is a testable property
 *    (the redaction test), so `ConfigError.message` is built only from env-var
 *    names and generic reasons.
 *
 * Key-list envs (`QCMS_LINK_KEYS`, `QCMS_SESSION_KEYS`, `QCMS_INTERNAL_TOKEN`)
 * accept a comma/whitespace-separated list — the **first entry signs, all
 * entries verify** (010's rotation model). Webhook signing does *not* use a
 * global env key: per-webhook secrets are stored encrypted under
 * `QCMS_APP_KEY` (SEC-6), handled in later tasks.
 *
 * Nothing here imports `node:*`; `loadConfig` takes an env record so it is pure
 * and testable. `serve.ts` calls `loadConfig(process.env)`.
 */

import { z } from "zod";

/** Minimum bytes for signing/secret material (SEC-4/SEC-7: >= 32 random bytes). */
export const MIN_SECRET_LENGTH = 32;
/** AES-256-GCM key length for `QCMS_APP_KEY` (SEC-6/SEC-8); 32 bytes = 256 bits. */
export const APP_KEY_MIN_LENGTH = 32;

/** Which route groups a process mounts (ADR-09: admin does not exist in public). */
export interface MountFlags {
  readonly public: boolean;
  readonly internal: boolean;
  readonly admin: boolean;
}

const MOUNT_SURFACES = ["public", "internal", "admin"] as const;
type MountSurface = (typeof MOUNT_SURFACES)[number];

/** The typed feature flags (ADR-24) that reach handlers via `deps`. */
export interface Flags {
  /** Challenge provider for abuse controls (026); Turnstile secrets required iff `turnstile`. */
  readonly challengeProvider: "none" | "turnstile";
  /** Admin 2FA policy (SEC-1); `optional` is the documented dev escape hatch. */
  readonly adminTwoFactor: "required" | "optional";
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
     * 20). Bounds the work — and the outbox/delivery row locks held — per tick;
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
  };
  readonly rateLimit: {
    readonly windowMs: number;
    readonly max: number;
  };
  readonly scheduler: {
    readonly outboxIntervalMs: number;
    readonly outboxJitterMs: number;
    readonly retentionSweepIntervalMs: number;
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
     * Minimum ms between session creation and submit. A submit faster than this
     * is flagged `too_fast`. `0` disables the check (the conservative default
     * until 026 tunes a real threshold — a wrong value silently drops real
     * submissions, so the wire ships inert).
     */
    readonly minSubmitMs: number;
    /**
     * Honeypot field name on the submit body. A non-empty value flags the
     * submission `honeypot`. A legitimate client never fills it, so the check is
     * always on; 026 may rename the field.
     */
    readonly honeypotField: string;
  };
  readonly flags: Flags;
  /** Challenge-provider secrets — present iff `flags.challengeProvider !== "none"`. */
  readonly challenge:
    | { readonly provider: "none" }
    | {
        readonly provider: "turnstile";
        readonly turnstile: { readonly siteKey: string; readonly secretKey: string };
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
 * Feature-flag registry (ADR-24). Every flag is declared here — name, env var,
 * value schema, default, description — and nothing else is a flag. `env` names
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
 * issue — by env-var name only, never echoing the value — when absent or not a
 * parseable absolute http/https URL.
 */
function parseRequiredHttpUrl(env: Env, name: string, issues: string[]): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    issues.push(`${name} is required (absolute http(s) URL of the respondent portal)`);
    return "";
  }
  const value = raw.trim();
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

/** Sensible defaults for the tunable, non-secret knobs. */
const DEFAULTS = {
  anonymousSessionMs: 24 * 60 * 60 * 1000, // 24h (matches @qcms/db retention default)
  rateLimitWindowMs: 60_000,
  rateLimitMax: 120,
  outboxIntervalMs: 5_000,
  outboxJitterMs: 1_000,
  retentionSweepIntervalMs: 60 * 60 * 1000, // 1h
  readyDbTimeoutMs: 2_000,
  webhookTimeoutMs: 10_000, // 10s per delivery attempt (025)
  webhookBatchSize: 20, // deliveries processed per pass (025)
  bodyLimitBytes: 1_000_000, // 1MB (SEC-9)
  antiAbuseMinSubmitMs: 0, // off until 026 tunes it (see antiAbuse.minSubmitMs)
  antiAbuseHoneypotField: "website", // conventional decoy field name
} as const;

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
    },
    rateLimit: {
      windowMs: parseInt_(env, "QCMS_RATE_LIMIT_WINDOW_MS", DEFAULTS.rateLimitWindowMs, 1, issues),
      max: parseInt_(env, "QCMS_RATE_LIMIT_MAX", DEFAULTS.rateLimitMax, 1, issues),
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
  };

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }
  return config;
}
