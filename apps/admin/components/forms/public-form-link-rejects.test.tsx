import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { PublicFormLink } from "./public-form-link.tsx";
import { t } from "../../lib/i18n/en.ts";

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
    expect(copy.hasAttribute("data-copied")).toBe(false);
  });
});
