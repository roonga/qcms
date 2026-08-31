import {
  type Context,
  type ContextManager,
  ROOT_CONTEXT,
  TraceFlags,
  context,
  trace,
} from "@opentelemetry/api";
import { afterAll, describe, expect, it } from "vitest";

import { createJsonLogger } from "./logger.js";

/**
 * The emitted line's KEY ORDER, pinned rather than described (issue #502).
 *
 * The module comment claimed `{ level, time, msg, ...fields }` while the literal
 * twelve lines below it appended `msg` last, and nothing was red for as long as
 * anyone can tell: every other assertion in the repo reads the line back through
 * `JSON.parse` and `toMatchObject`, both of which are order-blind. The wrong shape
 * then propagated into `docs/operations.md` twice and into a handover claim once,
 * because the comment is the most authoritative-looking description of a format
 * that nothing enforced.
 *
 * So the order is treated as a contract here. It is one for two reasons an
 * order-blind assertion cannot cover: the operator documentation prints example
 * lines an operator copies into a `jq` filter or diffs against captured bytes, and
 * `level` and `time` leading every line is what makes a raw `docker logs` tail
 * readable before anything parses it.
 *
 * These read the raw string from the sink, never a parsed object.
 */

const FIXED_TIME = "2026-08-31T00:00:00.000Z";

/**
 * A synchronous context manager, so `trace.getActiveSpan()` answers inside
 * `context.with`. The API package's default is the no-op one, under which a span
 * set on a context is never active and the correlation branch below would be
 * unreachable. Four lines of state beats pulling `@opentelemetry/sdk-node` into
 * this package's devDependencies to activate one span.
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

afterAll(() => {
  context.disable();
});

function capture(base?: Record<string, unknown>) {
  const lines: string[] = [];
  const logger = createJsonLogger({
    write: (line) => lines.push(line),
    now: () => new Date(FIXED_TIME),
    ...(base === undefined ? {} : { base }),
  });
  return { logger, lines };
}

/** The keys of one emitted line, in the order the serializer wrote them. */
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
    // The exact claim the module comment used to make. A line with no bindings and
    // no fields is the one case where `{ level, time, msg }` and the real shape
    // agree on the KEYS, and they still disagreed on nothing at all - which is why
    // the wrong description survived: the smallest example does not disprove it.
    const { logger, lines } = capture();
    logger.warn("bare");
    expect(keysOf(lines[0]!)).toEqual(["level", "time", "msg"]);
    expect(lines[0]).toBe(`{"level":"warn","time":"${FIXED_TIME}","msg":"bare"}`);
  });

  it("places the trace correlation between the bindings and the fields", () => {
    // Documented in the module comment as part of the same shape, and the only part
    // of it that appears conditionally, so it gets its own line rather than riding
    // on the first test's ordering.
    context.setGlobalContextManager(syncContextManager);
    const span = trace.wrapSpanContext({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: TraceFlags.SAMPLED,
    });
    const { logger, lines } = capture({ service: "qcms-api" });
    context.with(trace.setSpan(context.active(), span), () => {
      logger.info("traced", { path: "/health" });
    });
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
    // The other two halves of the sentence the module comment makes: `write` is
    // handed exactly one line, and adding the newline is the sink's job.
    const { logger, lines } = capture();
    logger.info("first");
    logger.error("second");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.endsWith("\n")).toBe(false);
  });
});
