/**
 * Every log message literal in the workspace is classified, or this goes red.
 *
 * The allowlist in `./otlp-log-allowlist.ts` matches `msg` as an exact string, so an
 * unlisted message exports as `application.event`. That is the right fail direction for
 * privacy (ADR-34) and a silent one for observability: nothing tells the author of a new
 * log call that the exported record will arrive with its body blanked. Two shipped
 * retention-sweep messages had been exporting that way since they landed (issue #490),
 * and they were found by a security review reading the file, not by any gate.
 *
 * So the gap itself is what this closes: a new message literal must be either admitted to
 * the export vocabulary or written down here as deliberately opaque. Both answers are
 * fine; leaving the question unanswered is what stops being possible.
 *
 * ## What the scan can and cannot see
 *
 * It reads tracked files with `git ls-files` rather than walking directories, because a
 * directory walk also reads build output an earlier gate left behind (issue #629). It
 * matches a **double-quoted string literal** as the first argument of a call whose
 * callee ends in `logger.<level>` (`logger.info`, `serverLogger.warn`,
 * `deps.logger.error`), with comments stripped textually first.
 *
 * Three limits, written down because an unstated limit is how this file's own defect
 * class starts:
 *
 * - **A non-literal message is invisible to it.** `serverLogger.warn(ORIGIN_BELT_REFUSED,
 *   ...)` and the sign-in throttle messages are constants, and `logger.warn(message)` in
 *   `apps/api/src/main.ts` is a parameter. Reading those needs the value, not the token,
 *   so the scan reports what it can see and stays honest about the rest. The constants
 *   that resolve to an admitted event (`origin.belt.refused`, `api.call`) are covered by
 *   their own tests beside them.
 * - **Comment stripping is textual**, so a `//` inside a string literal would truncate
 *   the rest of that line. The formatter gives every log call its own line and no message
 *   in the workspace contains one.
 * - **A template literal is not matched**, which is deliberate: an interpolated message
 *   cannot be an allowlist member anyway, and would arrive blanked.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { safeEventName } from "./otlp-log-allowlist.js";

/** Repo root, resolved from this file rather than from the process cwd. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Messages that are deliberately NOT part of the export vocabulary.
 *
 * Each is a diagnostic sentence for an operator already reading stdout, not an event
 * anyone counts, and each carries its meaning in wording that would grow a value the day
 * someone edits it. Opaque is the status quo for all three; they are listed rather than
 * admitted because admitting a message to the exported vocabulary is a privacy decision
 * (ADR-34, SEC-13) and these three do not need one made for them.
 */
const INTENTIONALLY_OPAQUE = new Set([
  // A not-implemented refusal on a path that fails closed. It fires once per refused
  // request in a configuration nobody runs yet (task 029).
  "challenge provider 'turnstile' is not implemented yet (029); failing closed",
  // Boot-time diagnostic, emitted with the error attached. The error itself is the
  // content and the OTLP path drops it whatever the body says.
  "could not read the sign-in throttle state",
  // A per-event data-shape warning, not a pass-level metric. `outbox delivery pass`
  // carries the counts an operator watches.
  "outbox event has no resolvable formId; consuming without fan-out",
]);

/**
 * Directories that hold shipped source. Only `src` and `lib` are walked, which is
 * what keeps build output out of the scan without a skip list: `dist`, `.next` and
 * `.next-dev` are siblings of these, never inside them (issue #629 is the same trap
 * from the other side, where a walk read what an earlier gate had left behind).
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

/** Remove block and line comments, so a message quoted in prose is not read as a call. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every double-quoted message literal handed to a logger, with the files it came from. */
function messageLiterals(): ReadonlyMap<string, readonly string[]> {
  // Deliberately `[^"\n]*` rather than an escape-aware alternation: the unrolled
  // form backtracks super-linearly, and no message in the workspace contains an
  // escaped double quote (the one message with an inner quote uses single quotes).
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

  // Guards the scan itself: a regex that silently stopped matching would let every
  // assertion below pass while proving nothing, which is the failure class this file
  // exists to close, one level up.
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
