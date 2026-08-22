import { describe, expect, it, vi } from "vitest";

import { copyRecoveryCodes, recoveryCodesText } from "./recovery-copy.ts";

/**
 * The copy control's decision, at the layer where all three of its cases are reachable
 * (issue 683).
 *
 * A static render can show that the button and the status region exist; it cannot show what
 * a press does, and what a press does is the whole of this feature's risk. These codes are
 * shown once and nothing reads them back, so an operator who believes they have them and
 * does not has lost the credential of last resort. The three cases below are the three ways
 * that belief can be formed or corrected.
 *
 * Red-first: against a tree without `lib/recovery-copy.ts` the file does not import at all.
 * Against the `?.`-short-circuit idiom this module deliberately does not use
 * (`components/forms/step-editor.tsx`), the absent-clipboard case is the one that fails: it
 * resolves to `undefined` rather than to an outcome, so the caller sets no status and the
 * operator is told nothing at all.
 */

const CODES = ["sample-0001", "sample-0002", "sample-0003"] as const;

describe("recoveryCodesText", () => {
  it("is one code per line, in the order shown", () => {
    expect(recoveryCodesText(CODES)).toBe("sample-0001\nsample-0002\nsample-0003");
  });

  it("copies every code, so a full set on screen is a full set on the clipboard", () => {
    const ten = Array.from({ length: 10 }, (_, index) => `code-${String(index)}`);
    expect(recoveryCodesText(ten).split("\n")).toEqual(ten);
  });
});

describe("copyRecoveryCodes", () => {
  it("reports the write it made", async () => {
    const writeText = vi.fn(async () => {
      await Promise.resolve();
    });

    await expect(copyRecoveryCodes({ writeText }, CODES)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(recoveryCodesText(CODES));
  });

  // The case the `?.` idiom would swallow. An insecure context or an older engine has no
  // `navigator.clipboard` at all, and the operator must be told that rather than left
  // looking at a button that did nothing.
  it("fails loudly when there is no clipboard to write to", async () => {
    await expect(copyRecoveryCodes(undefined, CODES)).resolves.toBe("failed");
  });

  it("fails when the write is refused", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("NotAllowedError")));

    await expect(copyRecoveryCodes({ writeText }, CODES)).resolves.toBe("failed");
  });

  // Not the same case as a rejection: an engine that throws out of `writeText` itself sails
  // straight past a `.then(ok, fail)` rejection handler, which is why this is a `try`.
  it("fails when the write throws rather than rejecting", async () => {
    const writeText = vi.fn(() => {
      throw new Error("SecurityError");
    });

    await expect(copyRecoveryCodes({ writeText }, CODES)).resolves.toBe("failed");
  });

  it("never rejects, so a press always leaves the status line with something in it", async () => {
    const clipboards = [
      undefined,
      { writeText: () => Promise.reject(new Error("no")) },
      {
        writeText: () => {
          throw new Error("no");
        },
      },
    ];

    for (const clipboard of clipboards) {
      // `resolves` is the assertion: a rejection here fails the test rather than being
      // reported as an outcome.
      await expect(copyRecoveryCodes(clipboard, CODES)).resolves.toBe("failed");
    }
  });

  // SEC-13: the codes go to the clipboard and nowhere else. A console write on the failure
  // path is the plausible mistake, and it would put a set of recovery codes into a browser
  // log that outlives the one screen they were ever meant to appear on.
  it("does not report the codes anywhere but the clipboard", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );

    await copyRecoveryCodes(undefined, CODES);
    await copyRecoveryCodes({ writeText: () => Promise.reject(new Error("no")) }, CODES);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
