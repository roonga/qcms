import { describe, expect, it } from "vitest";

import { parseArgs, USAGE } from "./reset-2fa-args.js";

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
    // pnpm forwards script arguments after a `--` of its own.
    const parsed = parseArgs(["--", "--email", "a@example.test", "--yes"]);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.email).toBe("a@example.test");
    expect(parsed.ok && parsed.confirm).toBe(true);
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
    const parsed = parseArgs(["--email", "a@example.test", "--yess"]);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.problem).toContain("--yess");
  });

  it("tells the operator which role the command wants", () => {
    expect(USAGE).toContain("qcms_migrate");
    expect(USAGE).toContain("--yes");
  });
});
