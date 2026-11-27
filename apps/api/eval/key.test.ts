import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  KEY_MISSING_MESSAGE,
  KEY_VARIABLE,
  assertKeyFree,
  keyFreeJson,
  readApiKey,
} from "./key.js";

const CLI = fileURLToPath(new URL("../../../scripts/agent-eval.mjs", import.meta.url));

const KEY = "synthetic-eval-key-6f21";

describe("the key the eval runs on", () => {
  it("reads it from the process environment", () => {
    expect(readApiKey({ [KEY_VARIABLE]: ` ${KEY} ` })).toBe(KEY);
  });

  it("stops rather than falling back when it is unset or blank", () => {
    expect(() => readApiKey({})).toThrow(KEY_MISSING_MESSAGE);
    expect(() => readApiKey({ [KEY_VARIABLE]: "  " })).toThrow(KEY_MISSING_MESSAGE);
  });

  it("says the same thing as the command line, which stops before any container starts", () => {
    expect(readFileSync(CLI, "utf8")).toContain(KEY_MISSING_MESSAGE);
  });
});

describe("the reader every result passes before it is written", () => {
  it("passes text the key is absent from", () => {
    expect(() => assertKeyFree("a result", "nothing of the sort here", KEY)).not.toThrow();
  });

  it("refuses text carrying the key", () => {
    expect(() => assertKeyFree("a result", `authorization: Bearer ${KEY}`, KEY)).toThrow(
      KEY_VARIABLE,
    );
  });

  it("refuses an empty key rather than passing every text", () => {
    expect(() => assertKeyFree("a result", "anything", "")).toThrow("empty key");
  });

  it("reads the whole file, headers and nested values alike", () => {
    const carried = { calls: [{ request: { headers: { authorization: KEY } } }] };

    expect(() => keyFreeJson("a trace", carried, KEY)).toThrow(KEY_VARIABLE);
    expect(keyFreeJson("a trace", { calls: [] }, KEY)).toContain('"calls"');
  });
});
