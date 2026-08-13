import { trace } from "@opentelemetry/api";
import { logs, type Logger as OtelLogger, SeverityNumber } from "@opentelemetry/api-logs";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

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
  "email",
  "phone",
  "clientaddress",
  "clientip",
  "ipaddress",
  "firstname",
  "lastname",
  "fullname",
  "displayname",
] as const;
const REDACT_EXACT = new Set(["key", "keys"]);
const REDACTED = "[REDACTED]";

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    REDACT_EXACT.has(lower) ||
    lower.endsWith("key") ||
    lower.endsWith("keys") ||
    REDACT_FRAGMENTS.some((fragment) => lower.includes(fragment))
  );
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value !== null && typeof value === "object") {
    // Error objects serialize to {} otherwise; keep name/message/stack. This is the
    // stdout line only: an Error redacts to an object, and only string, number and
    // boolean fields become OTLP attributes (see scalarAttributes below), so no
    // exception message or stack can reach an exported log record by this route.
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
  readonly write: (line: string) => void;
  readonly now?: () => Date;
  readonly base?: LogFields;
  readonly sendToOpenTelemetry?: boolean;
}

export function createJsonLogger(options: JsonLoggerOptions): Logger {
  const now = options.now ?? (() => new Date());
  const base = redact(options.base ?? {}) as LogFields;
  const otelLogger = options.sendToOpenTelemetry
    ? logs.getLogger("@qcms/observability")
    : undefined;
  return createLogger(options.write, now, otelLogger, base);
}

const SEVERITY: Readonly<Record<LogLevel, SeverityNumber>> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

function scalarAttributes(fields: LogFields): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attributes[key] = value;
    }
  }
  return attributes;
}

function createLogger(
  write: (line: string) => void,
  now: () => Date,
  otelLogger?: OtelLogger,
  bindings: LogFields = {},
): Logger {
  const emit =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      const safeFields = redact(fields ?? {}) as LogFields;
      const spanContext = trace.getActiveSpan()?.spanContext();
      const correlation =
        spanContext?.traceId && spanContext.spanId
          ? {
              trace_id: spanContext.traceId,
              span_id: spanContext.spanId,
              trace_flags: spanContext.traceFlags.toString(16).padStart(2, "0"),
            }
          : {};
      write(
        JSON.stringify({
          level,
          time: now().toISOString(),
          ...bindings,
          ...correlation,
          ...safeFields,
          msg: message,
        }),
      );
      otelLogger?.emit({
        body: message,
        severityNumber: SEVERITY[level],
        severityText: level.toUpperCase(),
        attributes: scalarAttributes({ ...bindings, ...safeFields }),
      });
    };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    child: (childBindings) => {
      const safeBindings = redact(childBindings) as LogFields;
      return createLogger(write, now, otelLogger, { ...bindings, ...safeBindings });
    },
  };
}

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
