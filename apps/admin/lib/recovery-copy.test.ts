import { describe, expect, it, vi } from "vitest";

import { copyRecoveryCodes, recoveryCodesText } from "./recovery-copy.ts";

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

  it("fails loudly when there is no clipboard to write to", async () => {
    await expect(copyRecoveryCodes(undefined, CODES)).resolves.toBe("failed");
  });

  it("fails when the write is refused", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("NotAllowedError")));

    await expect(copyRecoveryCodes({ writeText }, CODES)).resolves.toBe("failed");
  });

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
      await expect(copyRecoveryCodes(clipboard, CODES)).resolves.toBe("failed");
    }
  });

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
