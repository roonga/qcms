import {
  type Context,
  type ContextManager,
  ROOT_CONTEXT,
  TraceFlags,
  context,
  trace,
} from "@opentelemetry/api";
import { describe, expect, it } from "vitest";

import { createJsonLogger } from "./logger.js";

/**
 * The emitted line's key order, pinned rather than described. Every other
 * assertion over a log line parses it first, and both `JSON.parse` and
 * `toMatchObject` are order-blind, so a described order went unenforced and
 * reached the operator documentation wrong.
 *
 * The order is a contract for two reasons an order-blind assertion cannot cover:
 * the operator documentation prints example lines copied into a `jq` filter or
 * diffed against captured bytes, and the level and time leading every line is
 * what makes a raw log tail readable before anything parses it.
 *
 * These read the raw string from the sink, never a parsed object.
 */

const FIXED_TIME = "2026-08-31T00:00:00.000Z";

/**
 * A synchronous context manager, so `trace.getActiveSpan()` answers inside
 * `context.with`: the API package's default is a no-op under which the
 * correlation branch would be unreachable. Four lines of state beats pulling the
 * whole SDK into this package's devDependencies to activate one span.
 */
let currentContext: Context = ROOT_CONTEXT;
const syncContextManager: ContextManager = {
  active: () => currentContext,
  with: (ctx, fn, thisArg, ...args) => {
    const previous = currentContext;
    currentContext = ctx;
    try {
      return fn.call(thisArg, ...args);
    } finally {
      currentContext = previous;
    }
  },
  bind: (_ctx, target) => target,
  enable: () => syncContextManager,
  disable: () => {
    currentContext = ROOT_CONTEXT;
    return syncContextManager;
  },
};

function capture(base?: Record<string, unknown>) {
  const lines: string[] = [];
  const logger = createJsonLogger({
    write: (line) => lines.push(line),
    now: () => new Date(FIXED_TIME),
    ...(base === undefined ? {} : { base }),
  });
  return { logger, lines };
}

/** In the order the serializer wrote them. */
function keysOf(line: string): string[] {
  return Object.keys(JSON.parse(line) as Record<string, unknown>);
}

describe("emitted line shape", () => {
  it("orders the keys level, time, bindings, fields, msg", () => {
    const { logger, lines } = capture({ service: "qcms-api" });
    logger.child({ requestId: "req-1" }).info("hello", { path: "/health", status: 200 });
    expect(lines).toHaveLength(1);
    expect(keysOf(lines[0]!)).toEqual([
      "level",
      "time",
      "service",
      "requestId",
      "path",
      "status",
      "msg",
    ]);
  });

  it("puts msg last on a bare call too, not third", () => {
    // A line with no bindings and no fields is the one case where the keys agree
    // whatever the order, which is why the smallest example proves nothing.
    const { logger, lines } = capture();
    logger.warn("bare");
    expect(keysOf(lines[0]!)).toEqual(["level", "time", "msg"]);
    expect(lines[0]).toBe(`{"level":"warn","time":"${FIXED_TIME}","msg":"bare"}`);
  });

  it("places the trace correlation between the bindings and the fields", () => {
    // The only part of the shape that appears conditionally, so it gets its own
    // case rather than riding on the first test's ordering.
    const span = trace.wrapSpanContext({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: TraceFlags.SAMPLED,
    });
    const { logger, lines } = capture({ service: "qcms-api" });
    // The global context manager is process-wide state, so it is installed and
    // removed inside this test: an assertion that threw would otherwise leave it
    // installed for whatever ran next in this worker.
    context.setGlobalContextManager(syncContextManager);
    try {
      context.with(trace.setSpan(context.active(), span), () => {
        logger.info("traced", { path: "/health" });
      });
    } finally {
      context.disable();
    }
    expect(keysOf(lines[0]!)).toEqual([
      "level",
      "time",
      "service",
      "trace_id",
      "span_id",
      "trace_flags",
      "path",
      "msg",
    ]);
  });

  it("emits one line per call with no trailing newline", () => {
    // `write` is handed exactly one line, and adding the newline is the sink's
    // job.
    const { logger, lines } = capture();
    logger.info("first");
    logger.error("second");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.endsWith("\n")).toBe(false);
  });
});
