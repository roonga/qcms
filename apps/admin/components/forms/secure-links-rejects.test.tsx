import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { SecureLinks } from "./secure-links.tsx";
import { IDLE_MINT, IDLE_REVOKE } from "../../lib/forms/builder-state.ts";
import type { SecureLink } from "../../lib/forms/types.ts";
import { t } from "../../lib/i18n/en.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

/**
 * What an operator sees when a secure-link action REJECTS (issue #352, handlers 2 and 3
 * of nine, plus the clipboard chain that shares their failure mode).
 *
 * The server action is a prop, so the fake is the prop: everything from the `.then` chain
 * to the markup is the real component. See `form-actions-rejects.test.tsx` for why a
 * `TypeError` is the rejection worth forcing and why "nothing appeared" rather than "the
 * wrong thing appeared" is the regression being guarded.
 *
 * The revoke and mint dialogs both STAY OPEN on a rejection and render the sentence
 * themselves, which is the opposite of the publish dialog's choice and is deliberate in
 * both places: a modal covers the page's alert region, so a failure written only there
 * would leave the operator staring at an unchanged dialog. `within(dialog)` is what
 * asserts that rather than accepting the copy on the page behind it.
 */

const LINKS: readonly SecureLink[] = [
  {
    linkId: "lnk_1",
    state: "active",
    oneTime: false,
    expiresAt: "2027-01-01T00:00:00.000Z",
    consumedAt: null,
    revokedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

/** The rejection an unreachable API produces, which is the whole subject here. */
function transportFailure(): Promise<never> {
  return Promise.reject(new TypeError("fetch failed"));
}

// react-aria interaction under jsdom is CPU-bound: every simulated key dispatches a full
// event sequence and re-renders. The budget is per-file rather than per-test, matching
// `packages/ui/src/date-retraction.test.tsx`, which types into the same segmented control.
describe("a rejected secure-link action", { timeout: 30_000 }, () => {
  it("says no links were minted, and keeps the mint dialog open to say it", async () => {
    const user = userEvent.setup();
    render(
      <SecureLinks
        formId="form-1"
        links={{ ok: true, data: LINKS }}
        canMint
        maxBatch={10}
        mint={transportFailure}
        revoke={() => Promise.resolve(IDLE_REVOKE)}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.links.mint") }));
    const dialog = await screen.findByRole("dialog");

    // Confirm is disabled until an expiry exists, so the date has to be answered for
    // real. The en-US segmented DateField exposes each segment as a spinbutton.
    await user.click(within(dialog).getByRole("spinbutton", { name: /month/i }));
    await user.keyboard("01012027");

    await user.click(within(dialog).getByRole("button", { name: t("forms.links.confirmMint") }));

    expect(
      await within(dialog).findByText(t("forms.links.mintFailed", { message: unexpected() })),
    ).toBeTruthy();
    expect(dialog.isConnected).toBe(true);
  });

  it("says the link was not revoked, and keeps the revoke dialog open to say it", async () => {
    const user = userEvent.setup();
    render(
      <SecureLinks
        formId="form-1"
        links={{ ok: true, data: LINKS }}
        canMint
        maxBatch={10}
        mint={() => Promise.resolve(IDLE_MINT)}
        revoke={transportFailure}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.links.revoke") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: t("forms.links.confirmRevoke") }),
    );

    expect(
      await within(dialog).findByText(t("forms.links.revokeFailed", { message: unexpected() })),
    ).toBeTruthy();
    expect(dialog.isConnected).toBe(true);
  });
});

describe("a refused clipboard write on a minted link", { timeout: 30_000 }, () => {
  let restoreClipboard: (() => void) | undefined;

  afterEach(() => {
    restoreClipboard?.();
    restoreClipboard = undefined;
  });

  /**
   * Replace the clipboard with one that refuses.
   *
   * AFTER `userEvent.setup()`, never before: user-event installs its own working
   * clipboard stub on `navigator` during setup, so an override written first is simply
   * overwritten and the test silently exercises a successful copy.
   */
  function refuseClipboardWrites(): void {
    const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("write refused")) },
    });
    restoreClipboard = () => {
      if (previous === undefined) {
        delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
      } else {
        Object.defineProperty(globalThis.navigator, "clipboard", previous);
      }
    };
  }

  it("says the link could not be copied", async () => {
    const user = userEvent.setup();
    refuseClipboardWrites();
    render(
      <SecureLinks
        formId="form-1"
        links={{ ok: true, data: LINKS }}
        canMint
        maxBatch={10}
        mint={() =>
          Promise.resolve({
            status: "minted" as const,
            links: [
              { linkId: "lnk_2", url: "https://example.test/s/token", expiresAt: "2027-01-01" },
            ],
          })
        }
        revoke={() => Promise.resolve(IDLE_REVOKE)}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.links.mint") }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("spinbutton", { name: /month/i }));
    await user.keyboard("01012027");
    await user.click(within(dialog).getByRole("button", { name: t("forms.links.confirmMint") }));

    const panel = await screen.findByTestId("qcms-minted-links");
    await user.click(within(panel).getByRole("button", { name: t("forms.links.copy") }));

    // The failing copy is the only outcome the operator can act on: the URL is on screen
    // exactly once, so a silent refusal leaves them believing they have it.
    expect(await screen.findByText(t("forms.links.copyFailed"))).toBeTruthy();
  });
});
