import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { SecureLinks } from "./secure-links.tsx";
import { IDLE_MINT, IDLE_REVOKE } from "../../lib/forms/builder-state.ts";
import type { SecureLink } from "../../lib/forms/types.ts";
import { t } from "../../lib/i18n/en.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

const LINKS: readonly SecureLink[] = [
  {
    linkId: "lnk_1",
    environment: "prod",
    state: "active",
    oneTime: false,
    expiresAt: "2027-01-01T00:00:00.000Z",
    consumedAt: null,
    revokedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

function transportFailure(): Promise<never> {
  return Promise.reject(new TypeError("fetch failed"));
}

describe("a rejected secure-link action", { timeout: 30_000 }, () => {
  it("says no links were minted, and keeps the mint dialog open to say it", async () => {
    const user = userEvent.setup();
    render(
      <SecureLinks
        formId="form-1"
        environment="prod"
        links={{ ok: true, data: LINKS }}
        canMint
        maxBatch={10}
        mint={transportFailure}
        revoke={() => Promise.resolve(IDLE_REVOKE)}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.links.mint") }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("spinbutton", { name: /month/i }));
    await user.keyboard("01012027");

    await user.click(
      within(dialog).getByRole("button", {
        name: t("forms.links.confirmMint", { environment: "prod" }),
      }),
    );

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
        environment="prod"
        links={{ ok: true, data: LINKS }}
        canMint
        maxBatch={10}
        mint={() => Promise.resolve(IDLE_MINT)}
        revoke={transportFailure}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.links.revoke") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: t("forms.links.confirmRevoke") }));

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

  /* Override clipboard after userEvent.setup, which installs its own successful clipboard stub. */
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
        environment="prod"
        links={{ ok: true, data: LINKS }}
        canMint
        maxBatch={10}
        mint={() =>
          Promise.resolve({
            status: "minted" as const,
            links: [
              {
                linkId: "lnk_2",
                environment: "prod",
                url: "https://example.test/l/token",
                expiresAt: "2027-01-01",
              },
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
    await user.click(
      within(dialog).getByRole("button", {
        name: t("forms.links.confirmMint", { environment: "prod" }),
      }),
    );

    const panel = await screen.findByTestId("qcms-minted-links");
    await user.click(
      within(panel).getByRole("button", { name: t("forms.links.copyNumbered", { number: 1 }) }),
    );

    expect(await screen.findByText(t("forms.links.copyFailed"))).toBeTruthy();
  });
});
