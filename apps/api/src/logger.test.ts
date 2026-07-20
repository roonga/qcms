import { describe, expect, it } from "vitest";

import { createJsonLogger } from "./logger.js";

function capture() {
  const lines: string[] = [];
  const logger = createJsonLogger({
    write: (line) => lines.push(line),
    now: () => new Date("2026-07-20T00:00:00.000Z"),
    base: { service: "qcms-api" },
  });
  return {
    logger,
    lines,
    parsed: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe("createJsonLogger", () => {
  it("emits one JSON line per call with level, time, msg and base fields", () => {
    const { logger, parsed } = capture();
    logger.info("hello", { path: "/health" });
    const line = parsed()[0]!;
    expect(line).toMatchObject({
      level: "info",
      time: "2026-07-20T00:00:00.000Z",
      msg: "hello",
      service: "qcms-api",
      path: "/health",
    });
  });

  it("redacts secret-looking fields (SEC-8)", () => {
    const { logger, parsed } = capture();
    logger.info("auth", {
      internalToken: "super-secret-value",
      sessionToken: "another-secret",
      apiKey: "k",
      password: "p",
      authorization: "Bearer xyz",
      cookie: "session=abc",
      appKey: "aes-key",
      safe: "visible",
    });
    const line = parsed()[0]!;
    for (const field of [
      "internalToken",
      "sessionToken",
      "apiKey",
      "password",
      "authorization",
      "cookie",
      "appKey",
    ]) {
      expect(line[field]).toBe("[REDACTED]");
    }
    expect(line.safe).toBe("visible");
    // No secret value survives anywhere in the serialized line.
    const raw = JSON.stringify(line);
    for (const secret of ["super-secret-value", "another-secret", "Bearer xyz", "session=abc"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("never logs answer content (redacts answer-shaped keys)", () => {
    const { logger, parsed } = capture();
    logger.info("submit", { questionId: "q_a", answerValue: "PII text", answer: "more PII" });
    const line = parsed()[0]!;
    expect(line.questionId).toBe("q_a");
    expect(line.answerValue).toBe("[REDACTED]");
    expect(line.answer).toBe("[REDACTED]");
  });

  it("redacts nested secret fields", () => {
    const { logger, parsed } = capture();
    logger.info("nested", { config: { keys: { app: "topsecret" }, mount: "all" } });
    const line = parsed()[0]!;
    const config = line.config as Record<string, unknown>;
    expect(config.keys).toBe("[REDACTED]");
    expect(config.mount).toBe("all");
    expect(JSON.stringify(line)).not.toContain("topsecret");
  });

  it("serializes Error objects with name/message/stack", () => {
    const { logger, parsed } = capture();
    logger.error("boom", { err: new Error("kaboom") });
    const line = parsed()[0]!;
    const err = line.err as Record<string, unknown>;
    expect(err.name).toBe("Error");
    expect(err.message).toBe("kaboom");
    expect(typeof err.stack).toBe("string");
  });

  it("child() merges bindings into every line", () => {
    const { logger, parsed } = capture();
    logger.child({ requestId: "req-1" }).info("with-child");
    expect(parsed()[0]).toMatchObject({ requestId: "req-1", msg: "with-child" });
  });
});
