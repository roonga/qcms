import { describe, expect, it } from "vitest";

import { parseArgs, USAGE } from "./reset-2fa-args.js";

/**
 * The half of `qcms:reset-2fa`'s contract that needs no database (issue #432).
 *
 * One property here is a security property rather than ergonomics: **the default
 * is a dry run**. The command removes an authentication factor, and the shape
 * where a mistyped address reports instead of acting is the whole reason `--yes`
 * exists. A regression that made `confirm` default to true would still pass every
 * database-backed test in this repository, because those all pass the flag
 * explicitly.
 */
describe("parseArgs", () => {
  it("defaults to a dry run", () => {
    const parsed = parseArgs(["--email", "locked.out@example.test"]);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.confirm).toBe(false);
    expect(parsed.ok && parsed.email).toBe("locked.out@example.test");
  });

  it("confirms only on --yes, in either argument order", () => {
    for (const argv of [
      ["--email", "a@example.test", "--yes"],
      ["--yes", "--email", "a@example.test"],
    ]) {
      const parsed = parseArgs(argv);
      expect(parsed.ok && parsed.confirm).toBe(true);
    }
  });

  it("accepts the --email=value spelling", () => {
    const parsed = parseArgs(["--email=a@example.test", "--yes"]);
    expect(parsed.ok && parsed.email).toBe("a@example.test");
  });

  it("skips the end-of-options separator pnpm always inserts", () => {
    // `pnpm qcms:reset-2fa --email a@example.test --yes` arrives as
    // `node dist/reset-2fa.js -- --email a@example.test --yes`, and refusing that
    // `--` made every invocation through the root script print the usage.
    const parsed = parseArgs(["--", "--email", "a@example.test", "--yes"]);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.email).toBe("a@example.test");
    expect(parsed.ok && parsed.confirm).toBe(true);
    // And a bare separator with nothing after it is still a missing address.
    expect(parseArgs(["--"]).ok).toBe(false);
  });

  it("requires an address", () => {
    expect(parseArgs([]).ok).toBe(false);
    expect(parseArgs(["--yes"]).ok).toBe(false);
  });

  it("refuses --email with no value rather than swallowing the next flag", () => {
    const parsed = parseArgs(["--email", "--yes"]);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.problem).toContain("--email");
  });

  it("refuses an unrecognised argument instead of ignoring it", () => {
    // A mistyped `--yes` that parsed as "no flag given" would read to the operator
    // as a completed reset when nothing happened, and a mistyped `--email` as a
    // missing address. Both are refusals.
    const parsed = parseArgs(["--email", "a@example.test", "--yess"]);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.problem).toContain("--yess");
  });

  it("tells the operator which role the command wants", () => {
    // The usage text is the only place a hurried operator reads the SEC-10 rule.
    expect(USAGE).toContain("qcms_migrate");
    expect(USAGE).toContain("--yes");
  });
});
