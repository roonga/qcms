import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  assertBrowserLibrariesPresent,
  describeLibraryGaps,
  launchableBinaries,
  missingSharedLibraries,
  parseMissingLibraries,
  preflightBrowserLibraries,
} from "./browser-libs.js";

/**
 * The launch preflight (issue #249).
 *
 * The condition it exists for cannot be reproduced on a machine where the gate works,
 * so the parse and the message are tested against recorded `ldd` output rather than
 * against a broken install. The recorded lines are the ones from the issue.
 *
 * The other half of the contract is the one worth being strict about: this preflight
 * must never fail a run that would have succeeded. A wrong refusal here blocks the
 * merge gate itself, which is a larger failure than the confusing error it replaces.
 */

/** Real `ldd` output, from the host in issue #249. Tabs and spacing as emitted. */
const BROKEN_LDD = [
  "\tlinux-vdso.so.1 (0x00007ffd8b7f2000)",
  "\tlibasound.so.2 => not found",
  "\tlibnspr4.so => not found",
  "\tlibnss3.so => not found",
  "\tlibnssutil3.so => not found",
  "\tlibdl.so.2 => /lib/x86_64-linux-gnu/libdl.so.2 (0x00007f1c0a000000)",
  "",
].join("\n");

const HEALTHY_LDD = [
  "\tlinux-vdso.so.1 (0x00007ffd8b7f2000)",
  "\tlibnspr4.so => /lib/x86_64-linux-gnu/libnspr4.so (0x00007f1c0a200000)",
  "\t/lib64/ld-linux-x86-64.so.2 (0x00007f1c0a400000)",
  "",
].join("\n");

describe("parseMissingLibraries", () => {
  it("names every dependency the loader could not resolve", () => {
    expect(parseMissingLibraries(BROKEN_LDD)).toEqual([
      "libasound.so.2",
      "libnspr4.so",
      "libnss3.so",
      "libnssutil3.so",
    ]);
  });

  it("reports nothing for a binary whose dependencies all resolve", () => {
    expect(parseMissingLibraries(HEALTHY_LDD)).toEqual([]);
    expect(parseMissingLibraries("")).toEqual([]);
    expect(parseMissingLibraries("\tstatically linked\n")).toEqual([]);
  });

  it("reads output it does not recognise as nothing missing", () => {
    // "could not check" and "nothing missing" must both let the run proceed. The only
    // thing acted on is a positive, parsed list of names.
    expect(parseMissingLibraries("not a dynamic executable")).toEqual([]);
  });
});

describe("missingSharedLibraries", () => {
  it("reports nothing for a path that does not exist", () => {
    expect(missingSharedLibraries("/nonexistent/ms-playwright/chromium/chrome")).toEqual([]);
  });
});

describe("launchableBinaries", () => {
  it("always includes the path Playwright reports", () => {
    // Even when the browsers root cannot be read, the caller's own binary is checked:
    // that is the one the Lighthouse gate launches through chrome-launcher.
    const chrome = "/nowhere/ms-playwright/chromium-1234/chrome-linux64/chrome";
    expect(launchableBinaries(chrome)).toEqual([chrome]);
  });

  it("finds the headless shell beside it in a real installation", () => {
    // Derived from the live install rather than a fixture tree, because the point of
    // the search is that it survives a revision bump without an edit here. Skipped
    // when the browsers are not downloaded, which is a different failure entirely.
    const chromePath = chromium.executablePath();
    const binaries = launchableBinaries(chromePath);
    expect(binaries[0]).toBe(chromePath);
    for (const binary of binaries.slice(1)) expect(binary).toContain("chrome-headless-shell");
  });
});

describe("describeLibraryGaps", () => {
  const message = describeLibraryGaps([
    { binary: "/root/.cache/ms-playwright/x/chrome-headless-shell", missing: ["libnspr4.so"] },
  ]);

  it("names the binary and the missing library", () => {
    expect(message).toContain("chrome-headless-shell");
    expect(message).toContain("libnspr4.so");
  });

  it("names the symptom, so the confusing error is recognisable", () => {
    expect(message).toContain("Target page, context or browser has been closed");
  });

  it("gives the host fix as a command that can be pasted", () => {
    expect(message).toContain("playwright install-deps chromium");
  });

  it("warns that the container route does not accept a host-created worktree", () => {
    // The half that cost the hour in the issue: the container has the libraries, and
    // running the gate there from a host worktree still does not work.
    expect(message).toContain("ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY");
  });
});

describe("assertBrowserLibrariesPresent", () => {
  it("passes on a platform where ldd is not the answer", () => {
    expect(() =>
      assertBrowserLibrariesPresent("/Applications/Chromium.app/chrome", "darwin"),
    ).not.toThrow();
    expect(() => assertBrowserLibrariesPresent("chrome.exe", "win32")).not.toThrow();
  });

  it("passes when the binary cannot be found at all", () => {
    // Not this preflight's question. A missing browser is Playwright's own error and
    // it is already a clear one.
    expect(() => assertBrowserLibrariesPresent("/nonexistent/chrome", "linux")).not.toThrow();
  });
});

describe("preflightBrowserLibraries", () => {
  it("says nothing on a machine where the suite can run", () => {
    // The half that has to hold everywhere this test itself runs. A refusal on a
    // working host would block the merge gate rather than explain it, and a host with
    // no browsers downloaded at all (CI's `verify` job) must reach Playwright's own
    // "run playwright install" rather than a config that fails to load.
    expect(() => preflightBrowserLibraries()).not.toThrow();
  });
});
