/**
 * Every log message literal in the workspace is classified, or this goes red: an
 * unlisted message exports blanked, which is silent for observability, so a new
 * literal must be admitted to the vocabulary or written down below as
 * deliberately opaque.
 *
 * Known limits: a non-literal message is invisible to the scan, comment
 * stripping is textual, and a template literal is deliberately unmatched, an
 * interpolated message not being an allowlist member.
 *
 * This reads the whole workspace while the task cache keys on one package, which
 * once replayed a stale green. `turbo.json` widens the key to match this walk and
 * `scripts/turbo-scan-inputs.test.ts` derives {@link SOURCE_ROOTS} and
 * {@link SOURCE_DIRS} from here, so widening the walk is complete only once that
 * entry follows.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { safeEventName } from "./otlp-log-allowlist.js";

/** Resolved from this file rather than from the process cwd. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Messages deliberately not part of the export vocabulary: each is a diagnostic
 * for an operator already reading stdout rather than an event anyone counts, and
 * admitting one is a privacy decision (ADR-34, SEC-13).
 */
const INTENTIONALLY_OPAQUE = new Set([
  "challenge provider 'turnstile' is not implemented yet (029); failing closed",
  "challenge provider: no control.environments row; failing closed",
  "challenge provider: unknown name on the environment; failing closed",
  "could not read the sign-in throttle state",
  "outbox event has no resolvable formId; consuming without fan-out",
  "draft assist stream failed",
]);

/** Keeps build output out of the scan without a skip list. */
const SOURCE_ROOTS = ["apps", "packages"] as const;
const SOURCE_DIRS = new Set(["src", "lib"]);

/** Every `.ts`/`.tsx` file under a workspace member's `src` or `lib`, tests aside. */
function shippedSources(): readonly string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        if (["e2e", "__tests__", "test-support"].includes(entry.name)) continue;
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx|mts)$/.test(entry.name)) continue;
      if (/\.(test|e2e|pw)\.[a-z]+$/.test(entry.name)) continue;
      found.push(path);
    }
  };

  for (const root of SOURCE_ROOTS) {
    for (const member of readdirSync(join(REPO_ROOT, root), { withFileTypes: true })) {
      if (!member.isDirectory()) continue;
      for (const child of readdirSync(join(REPO_ROOT, root, member.name), {
        withFileTypes: true,
      })) {
        if (child.isDirectory() && SOURCE_DIRS.has(child.name)) {
          walk(`${root}/${member.name}/${child.name}`);
        }
      }
    }
  }
  return found;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function messageLiterals(): ReadonlyMap<string, readonly string[]> {
  // Deliberately not escape-aware: the unrolled form backtracks super-linearly,
  // and no message in the workspace contains an escaped double quote.
  const call = /[Ll]ogger\.(?:debug|info|warn|error)\(\s*"([^"\n]*)"/g;
  const found = new Map<string, string[]>();
  for (const file of shippedSources()) {
    const source = stripComments(readFileSync(join(REPO_ROOT, file), "utf8"));
    for (const match of source.matchAll(call)) {
      const message = match[1];
      if (message === undefined) continue;
      const files = found.get(message) ?? [];
      if (!files.includes(file)) files.push(file);
      found.set(message, files);
    }
  }
  return found;
}

describe("OTLP allowlist coverage", () => {
  const literals = messageLiterals();

  // A regex that stopped matching would let every assertion below pass.
  it("finds the messages it is supposed to be classifying", () => {
    expect(literals.size).toBeGreaterThan(8);
    expect([...literals.keys()]).toContain("retention sweep");
  });

  it("classifies every shipped message literal as exported or deliberately opaque", () => {
    const unclassified = [...literals]
      .filter(([message]) => safeEventName(message) !== message)
      .filter(([message]) => !INTENTIONALLY_OPAQUE.has(message))
      .map(([message, files]) => `${JSON.stringify(message)} (${files.join(", ")})`);

    expect(
      unclassified,
      "these messages export as `application.event`, with their body silently dropped." +
        " Add each to SAFE_EVENTS in otlp-log-allowlist.ts, or to INTENTIONALLY_OPAQUE above",
    ).toEqual([]);
  });

  it("keeps the two retention-sweep records exported rather than blanked (issue #490)", () => {
    expect(safeEventName("delivery response snippets redacted")).toBe(
      "delivery response snippets redacted",
    );
    expect(safeEventName("outbox payload answers redacted")).toBe(
      "outbox payload answers redacted",
    );
  });

  it("does not admit a message merely by listing it as opaque", () => {
    for (const message of INTENTIONALLY_OPAQUE) {
      expect(safeEventName(message)).toBe("application.event");
    }
  });
});
