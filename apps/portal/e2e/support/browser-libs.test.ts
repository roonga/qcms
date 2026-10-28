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
    const chrome = "/nowhere/ms-playwright/chromium-1234/chrome-linux64/chrome";
    expect(launchableBinaries(chrome)).toEqual([chrome]);
  });

  it("finds the headless shell beside it in a real installation", () => {
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
    expect(() => assertBrowserLibrariesPresent("/nonexistent/chrome", "linux")).not.toThrow();
  });
});

describe("preflightBrowserLibraries", () => {
  it("says nothing on a machine where the suite can run", () => {
    expect(() => preflightBrowserLibraries()).not.toThrow();
  });
});
