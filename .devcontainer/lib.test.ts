import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const LIB = fileURLToPath(new URL("lib.sh", import.meta.url));

function runBash(body: string) {
  const script = `set -euo pipefail\nsource "${LIB}"\nsleep() { :; }\n${body}\n`;
  return spawnSync("bash", ["-c", script], { encoding: "utf8" });
}

describe("retry", () => {
  it("runs the command once when it succeeds, without announcing a retry", () => {
    const res = runBash(`retry "ok-case" true; echo "exit=$?"`);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("exit=0");
    expect(res.stderr).not.toContain("retrying");
  });

  it("recovers when a command fails and then succeeds", () => {
    const res = runBash(`
      n=0
      flaky() { n=$((n + 1)); [ "$n" -ge 3 ]; }
      retry "flaky-case" flaky
      echo "attempts=$n"
    `);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("attempts=3");
    expect(res.stderr).toContain("flaky-case failed (attempt 1/3)");
    expect(res.stderr).toContain("flaky-case failed (attempt 2/3)");
  });

  it("gives up after the final attempt and reports failure", () => {
    const res = runBash(
      `if retry "always-fails" false; then echo UNEXPECTED; else echo "gave-up=$?"; fi`,
    );

    expect(res.stdout).toContain("gave-up=1");
    expect(res.stdout).not.toContain("UNEXPECTED");
    expect(res.stderr).toContain("always-fails failed after 3 attempts");
  });

  it("returns non-zero so `set -e` aborts rather than provisioning half a container", () => {
    const res = runBash(`retry "always-fails" false\necho "SHOULD NOT REACH"`);

    expect(res.status).toBe(1);
    expect(res.stdout).not.toContain("SHOULD NOT REACH");
  });

  it("honours RETRY_MAX_ATTEMPTS so the count is not hard-coded", () => {
    const res = runBash(`
      n=0
      counter() { n=$((n + 1)); false; }
      RETRY_MAX_ATTEMPTS=5
      if retry "bounded" counter; then echo UNEXPECTED; fi
      echo "attempts=$n"
    `);

    expect(res.stdout).toContain("attempts=5");
  });
});
