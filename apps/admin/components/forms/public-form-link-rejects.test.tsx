import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { PublicFormLink } from "./public-form-link.tsx";
import { t } from "../../lib/i18n/en.ts";

/**
 * What an author sees when copying the public address cannot work (issue #352).
 *
 * ## Why this test removes the clipboard rather than making it reject
 *
 * `navigator.clipboard` is ABSENT in an insecure context and on older engines, so reading
 * `.writeText` off it throws a `TypeError` SYNCHRONOUSLY. That is the case the component's
 * shape exists for: the call sits inside `Promise.resolve().then(...)` precisely so a
 * synchronous throw becomes a rejection the `.catch` can see. Called bare, the throw
 * happens before any promise exists, no `.catch` runs, and the click handler itself blows
 * up. A test that only made `writeText` reject would pass against both shapes and prove
 * nothing about the one that matters, so this one deletes the clipboard.
 *
 * Deleted AFTER `userEvent.setup()`, which installs its own working clipboard stub on
 * `navigator`: doing it first is silently undone.
 */

describe("copying the public form link with no clipboard available", () => {
  let restoreClipboard: (() => void) | undefined;

  afterEach(() => {
    restoreClipboard?.();
    restoreClipboard = undefined;
  });

  function removeClipboard(): void {
    const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
    delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
    restoreClipboard = () => {
      if (previous !== undefined) {
        Object.defineProperty(globalThis.navigator, "clipboard", previous);
      }
    };
  }

  it("says the copy failed and leaves the icon unticked", async () => {
    const user = userEvent.setup();
    removeClipboard();

    render(<PublicFormLink url="https://example.test/f/intake" isClosed={false} />);

    const copy = screen.getByRole("button", { name: t("forms.publicLink.copy") });
    await user.click(copy);

    expect(await screen.findByText(t("forms.links.copyFailed"))).toBeTruthy();
    // The tick would claim the address is on the clipboard when it is not, which is the
    // one thing this control must never say.
    expect(copy.hasAttribute("data-copied")).toBe(false);
  });
});
