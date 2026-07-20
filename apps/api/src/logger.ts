/**
 * Structured logging (task 017, SEC-8).
 *
 * Logging is an **injected interface**, never a concrete Node logger reached
 * from handler scope: API handlers stay fetch-pure (R4), so they call this
 * `Logger` interface and the composition root (`serve.ts`) supplies the
 * concrete sink. `createJsonLogger` takes a plain `write(line)` function — the
 * server passes one that writes JSON lines to stdout; tests pass a capturing
 * sink. Nothing here imports `node:*`.
 *
 * Redaction (SEC-8): every field whose key looks like a secret or like
 * respondent content is replaced with `"[REDACTED]"` before serialization, so
 * a careless `logger.info("...", { token })` can never leak the value.
 * Answer content is never logged by policy (log questionIds and counts, not
 * values); the redactor is the backstop, not the primary control.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derive a logger that merges `bindings` into every subsequent line. */
  child(bindings: LogFields): Logger;
}

/**
 * Field-name fragments that mark a value as a secret or as respondent content.
 * Matched case-insensitively as substrings, so `sessionToken`, `QCMS_APP_KEY`,
 * `authorization`, and `answerValue` are all caught. Kept deliberately broad —
 * over-redaction in a log line is harmless; a leaked secret is not.
 */
const REDACT_FRAGMENTS = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "credential",
  "answer",
  "answervalue",
] as const;

/** A bare `key` field (signing-key material) is redacted; `publicKey` etc. too. */
const REDACT_EXACT = new Set(["key", "keys"]);

const REDACTED = "[REDACTED]";

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (REDACT_EXACT.has(lower)) return true;
  if (lower.endsWith("key") || lower.endsWith("keys")) return true;
  return REDACT_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/** Recursively redact secret-looking keys; bounded depth guards cyclic input. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    // Error objects serialize to {} otherwise; keep name/message/stack.
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSecretKey(key) ? REDACTED : redact(inner, depth + 1);
    }
    return out;
  }
  return value;
}

export interface JsonLoggerOptions {
  /** Sink for one serialized line (no trailing newline is added by callers). */
  readonly write: (line: string) => void;
  /** Clock for the `time` field; defaults to `Date.now`-based ISO timestamps. */
  readonly now?: () => Date;
  /** Static fields merged into every line (e.g. `{ service: "qcms-api" }`). */
  readonly base?: LogFields;
}

/**
 * A JSON-lines logger: each call emits one `write(JSON.stringify({...}))`
 * containing `{ level, time, msg, ...redactedFields }`. Deterministic and
 * dependency-free, so it is trivially testable with a capturing `write`.
 */
export function createJsonLogger(options: JsonLoggerOptions): Logger {
  const now = options.now ?? (() => new Date());
  const base = options.base ?? {};

  function emit(level: LogLevel, message: string, fields?: LogFields): void {
    const merged: LogFields = { ...base, ...(fields ?? {}) };
    const line = {
      level,
      time: now().toISOString(),
      msg: message,
      ...(redact(merged) as LogFields),
    };
    options.write(JSON.stringify(line));
  }

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (bindings) => createJsonLogger({ ...options, base: { ...base, ...bindings } }),
  };
}

/** A logger that discards everything — the default for tests that ignore logs. */
export function createNullLogger(): Logger {
  const noop = (): void => undefined;
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  };
  return logger;
}
