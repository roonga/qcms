/**
 * Structured logging (task 017, SEC-8; pino-backed since task 054 / ADR-34).
 *
 * Logging is an **injected interface**, never a concrete Node logger reached
 * from handler scope: API handlers stay fetch-pure (R4), so they call this
 * `Logger` interface and the composition root (`serve.ts`) supplies the
 * concrete sink. `createJsonLogger` takes a plain `write(line)` function - the
 * server passes one that writes JSON lines to stdout; tests pass a capturing
 * sink.
 *
 * **The interface is the contract; pino is an implementation detail.** Task 054
 * moved the serialization behind pino for exactly one reason: with the OTel SDK
 * running, `@opentelemetry/instrumentation-pino` injects `trace_id`/`span_id`
 * into every line automatically, so log-to-trace correlation needs no
 * context-lookup code of ours and no call-site change anywhere. The emitted
 * shape is unchanged (`{ level, time, msg, ...fields }`, level as a word, time
 * as an ISO instant, one line per call, no trailing newline handed to `write`),
 * and `LogFields`/`Logger`/`createNullLogger` are untouched.
 *
 * Redaction (SEC-8): every field whose key looks like a secret or like
 * respondent content is replaced with `"[REDACTED]"` before serialization, so
 * a careless `logger.info("...", { token })` can never leak the value.
 * Answer content is never logged by policy (log questionIds and counts, not
 * values); the redactor is the backstop, not the primary control. It runs
 * *before* pino sees the fields, so pino's own serializers never observe an
 * unredacted value.
 */

import { createRequire } from "node:module";

import type { DestinationStream, Logger as PinoLogger, LoggerOptions } from "pino";

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
 * `authorization`, and `answerValue` are all caught. Kept deliberately broad -
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
 * pino's factory, loaded through `createRequire` rather than an `import`.
 *
 * This is not a style choice and it is not avoidable at the import site: pino is
 * CommonJS, and `@opentelemetry/instrumentation-pino` patches it through
 * require-in-the-middle, which only sees a **`require`**. Node's ESM-to-CJS
 * interop reads the module's exports straight out of the CJS cache, so an
 * `import pino from "pino"` receives the unpatched factory and the trace-context
 * injection silently never happens (measured: identical setup, `trace_id` present
 * via `createRequire`, absent via `import`). The alternative upstream offers is
 * registering the import-in-the-middle ESM loader hook for the whole app graph -
 * a much larger blast radius than one require for one CJS package.
 *
 * The call is deferred into {@link createJsonLogger} on purpose: the module must
 * not be required until the composition root has started the SDK (see
 * `telemetry.ts`), because the patch applies at require time.
 */
const requireFromHere = createRequire(import.meta.url);
type PinoFactory = (options: LoggerOptions, stream: DestinationStream) => PinoLogger;

/**
 * A JSON-lines logger: each call emits one `write(...)` of
 * `{ level, time, msg, ...redactedFields }` (plus `trace_id`/`span_id` when a
 * span is active and the OTel SDK is running - injected by
 * `instrumentation-pino`, not by anything here). Backed by pino; the `write`
 * sink keeps it trivially testable.
 */
export function createJsonLogger(options: JsonLoggerOptions): Logger {
  const pino = requireFromHere("pino") as PinoFactory;
  const now = options.now ?? (() => new Date());
  const base = redact(options.base ?? {}) as LogFields;

  const pinoOptions: LoggerOptions = {
    // Every level the `Logger` interface exposes must be emitted; pino's own
    // default ("info") would silently swallow `logger.debug(...)`.
    level: "debug",
    // Replaces pino's default `{ pid, hostname }` bindings, so the emitted line
    // carries exactly the fields the caller asked for and nothing else.
    base,
    // `level` as the word, not pino's numeric code: the shape callers, the CI
    // log gates, and `logger.test.ts` all read (`"level":"warn"`).
    formatters: { level: (label) => ({ level: label }) },
    // The injected clock, rendered as an ISO instant. pino requires the fragment
    // to include its own leading comma and key.
    timestamp: () => `,"time":"${now().toISOString()}"`,
  };

  const destination: DestinationStream = {
    // pino terminates each line with a newline; the `write` contract here is one
    // line WITHOUT it (callers add their own, e.g. `stdout.write(line + "\n")`).
    write: (chunk) => options.write(chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk),
  };

  return fromPino(pino(pinoOptions, destination));
}

/** Adapt a pino logger to the injected `Logger` interface (SEC-8 redaction included). */
function fromPino(pino: PinoLogger): Logger {
  const emit =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      // Redact BEFORE pino: the backstop must run on every field, whatever pino
      // would otherwise do with it.
      pino[level](redact(fields ?? {}) as LogFields, message);
    };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    child: (bindings) => fromPino(pino.child(redact(bindings) as LogFields)),
  };
}

/** A logger that discards everything - the default for tests that ignore logs. */
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
