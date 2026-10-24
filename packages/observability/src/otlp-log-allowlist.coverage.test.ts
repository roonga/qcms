/**
 * Every log message literal in the workspace is classified, or this goes red.
 *
 * The export allowlist matches a message as an exact string, so an unlisted one
 * exports blanked: the right fail direction for privacy (ADR-34) and a silent
 * one for observability, since nothing tells the author of a new log call. So a
 * new literal must be either admitted to the export vocabulary or written down
 * here as deliberately opaque; what stops being possible is leaving the question
 * unanswered.
 *
 * The scan walks each workspace member's `src` and `lib` and matches a
 * double-quoted literal as the first argument of a logger call, comments
 * stripped textually first. A walk rather than `git ls-files`, because this
 * package's lint forbids resolving a command off `PATH`, and the `src`/`lib`
 * restriction is what keeps build output out of it without a skip list.
 *
 * Three limits, written down because an unstated limit is how this file's own
 * defect class starts. A non-literal message is invisible to it, so the scan
 * reports what it can see and the constants have their own tests beside them.
 * Comment stripping is textual, so a `//` inside a literal would truncate the
 * line, which no message in the workspace contains. A template literal is not
 * matched, deliberately: an interpolated message cannot be an allowlist member.
 *
 * A scan is only as good as the run that executes it, and this one reads the
 * whole workspace while the task cache keys on one package, which once replayed
 * a stale green for exactly the change it exists to catch. The cache key is
 * widened to match this walk in `turbo.json`, and `scripts/turbo-scan-inputs.test.ts`
 * derives {@link SOURCE_ROOTS} and {@link SOURCE_DIRS} from this file to hold
 * the two together, so widening the walk is complete only once that entry
 * follows it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { safeEventName } from "./otlp-log-allowlist.js";

/** Repo root, resolved from this file rather than from the process cwd. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Messages deliberately not part of the export vocabulary.
 *
 * Each is a diagnostic sentence for an operator already reading stdout rather
 * than an event anyone counts. They are listed rather than admitted because
 * admitting a message is a privacy decision (ADR-34, SEC-13) and none of these
 * needs one made for it.
 */
const INTENTIONALLY_OPAQUE = new Set([
  "challenge provider 'turnstile' is not implemented yet (029); failing closed",
  // The environment these name is their whole content, and the attribute is
  // dropped like every unlisted one, so an exported body would say only that
  // something was wrong somewhere.
  "challenge provider: no control.environments row; failing closed",
  "challenge provider: unknown name on the environment; failing closed",
  // The attached error is the content, and the OTLP path drops it whatever the
  // body says.
  "could not read the sign-in throttle state",
  // A per-event data-shape warning rather than a pass-level metric.
  "outbox event has no resolvable formId; consuming without fan-out",
  // A per-request diagnostic for a turn whose stream threw: a broken provider
  // connection is something an operator reads a trace for rather than counts.
  "draft assist stream failed",
]);

/**
 * Only `src` and `lib` are walked, which keeps build output out of the scan
 * without a skip list: the build directories are siblings of these, never
 * inside them.
 */
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

/** So a message quoted in prose is not read as a call. */
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

  // Guards the scan itself: a regex that stopped matching would let every
  // assertion below pass while proving nothing.
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
