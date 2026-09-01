import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { stripTags } from "./test-support/markup.ts";

/**
 * The recovery-code panel's MARKUP contract (issue 683).
 *
 * What both POCs draw, and so what this asserts: the ten codes as a labelled list, a "Copy
 * codes" button, and a status line that is **present and empty on the first paint** with
 * `aria-live="polite"` on it. That last part is the one a reviewer cannot see in a frame and
 * is the reason this test exists at a layer below the browser: a live region mounted on the
 * first press, with its text already in it, is not announced at all (#307), and the
 * difference between that and the correct shape is invisible in a screenshot of either state.
 *
 * What a press does is `lib/recovery-copy.test.ts`, because the admin has no jsdom layer and
 * a `useState` transition is not observable in a static render. That the two are wired
 * together is `e2e/recovery-copy.pw.ts`.
 */

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

  // The region has to exist before the change it announces, and it has to be empty until
  // there is something to say: text present on the first paint would be announced on arrival,
  // claiming a copy nobody made.
  it("mounts the status region empty and polite, before any press", () => {
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('data-testid="qcms-recovery-copy-status"');
    expect(markup).not.toContain(t("recovery.copied"));
    expect(markup).not.toContain(t("recovery.copyFailed"));
  });

  // The status line's two sentences are catalogue entries, not literals in the component
  // (ADR-27), and the failure one has to name the remedy rather than the cause: an operator
  // told "clipboard unavailable" still has to work out that the codes are selectable.
  it("has a failure sentence that tells the operator what to do instead", () => {
    expect(t("recovery.copyFailed")).toContain("Select the codes above");
  });
});
