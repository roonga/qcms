import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { stripTags } from "./test-support/markup.ts";

const { t } = await import("../lib/i18n/en.ts");
const { RecoveryCodes } = await import("./recovery-codes.tsx");

const CODES = Array.from(
  { length: 10 },
  (_, index) => `sample-${String(index + 1).padStart(4, "0")}`,
);

const markup = renderToStaticMarkup(<RecoveryCodes codes={CODES} />);

describe("the recovery-code panel", () => {
  it("renders every code as a list item under the list's own label", () => {
    expect(markup).toContain(`aria-label="${t("recovery.listLabel")}"`);
    for (const code of CODES) {
      expect(markup).toContain(`<li>${code}</li>`);
    }
  });

  it("offers the copy control the POCs draw", () => {
    expect(stripTags(markup)).toContain(t("recovery.copy"));
  });

  it("mounts the status region empty and polite, before any press", () => {
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('data-testid="qcms-recovery-copy-status"');
    expect(markup).not.toContain(t("recovery.copied"));
    expect(markup).not.toContain(t("recovery.copyFailed"));
  });

  it("has a failure sentence that tells the operator what to do instead", () => {
    expect(t("recovery.copyFailed")).toContain("Select the codes above");
  });
});
