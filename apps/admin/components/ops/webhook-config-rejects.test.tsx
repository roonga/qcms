import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { WebhookConfig } from "./webhook-config.tsx";
import { t } from "../../lib/i18n/en.ts";
import type { WebhookSummary } from "../../lib/ops/types.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

/**
 * What an operator sees when a webhook mutation REJECTS, and when copying a revealed
 * secret cannot work (issue #352, handler 7 of nine plus the clipboard chain beside it).
 *
 * The five mutations share one `run` helper, so one rejected mutation exercises the whole
 * handler; create is the one chosen because its dialog is the one an operator is most
 * likely to be standing in front of when the API goes away.
 */

const HOOK: WebhookSummary = {
  webhookId: "whk_1",
  url: "https://example.test/hook",
  active: true,
  deactivatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function idle(): Promise<{ readonly status: "idle" }> {
  return Promise.resolve({ status: "idle" });
}

describe("a rejected webhook mutation", { timeout: 30_000 }, () => {
  it("says nothing reached the server, and keeps the dialog open to say it", async () => {
    const user = userEvent.setup();
    render(
      <WebhookConfig
        webhooks={{ ok: true, data: [HOOK] }}
        create={() => Promise.reject(new TypeError("fetch failed"))}
        rotate={idle}
        deactivate={idle}
        reactivate={idle}
        retarget={idle}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("ops.webhooks.add") }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: t("ops.webhooks.url") }),
      "https://example.test/new",
    );
    await user.click(within(dialog).getByRole("button", { name: t("ops.webhooks.create") }));

    // The dialog renders the failure itself, which is the only place an operator inside a
    // modal can read it.
    expect(await within(dialog).findByText(unexpected())).toBeTruthy();
    expect(dialog.isConnected).toBe(true);
  });
});

describe(
  "copying a revealed webhook secret with no clipboard available",
  { timeout: 30_000 },
  () => {
    let restoreClipboard: (() => void) | undefined;

    afterEach(() => {
      restoreClipboard?.();
      restoreClipboard = undefined;
    });

    /**
     * Remove `navigator.clipboard`, which is what an insecure context looks like.
     *
     * AFTER `userEvent.setup()`, which installs a working clipboard stub of its own, and
     * removed rather than made to reject: reading `.writeText` off an absent clipboard
     * throws SYNCHRONOUSLY, and a `.catch` on the returned promise never sees a throw that
     * happens before the promise exists. That distinction is the whole reason
     * `public-form-link.tsx` and `secure-links.tsx` open their chains with
     * `Promise.resolve().then(...)`, so it is the case worth forcing here too.
     */
    function removeClipboard(): void {
      const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
      delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
      restoreClipboard = () => {
        if (previous !== undefined) {
          Object.defineProperty(globalThis.navigator, "clipboard", previous);
        }
      };
    }

    it("says the secret could not be copied", async () => {
      const user = userEvent.setup();
      removeClipboard();

      render(
        <WebhookConfig
          webhooks={{ ok: true, data: [HOOK] }}
          create={() =>
            Promise.resolve({
              status: "done" as const,
              revealed: {
                webhookId: "whk_2",
                url: "https://example.test/new",
                active: true,
                secret: "whsec_example",
              },
            })
          }
          rotate={idle}
          deactivate={idle}
          reactivate={idle}
          retarget={idle}
        />,
      );

      await user.click(screen.getByRole("button", { name: t("ops.webhooks.add") }));
      const dialog = await screen.findByRole("dialog");
      await user.type(
        within(dialog).getByRole("textbox", { name: t("ops.webhooks.url") }),
        "https://example.test/new",
      );
      await user.click(within(dialog).getByRole("button", { name: t("ops.webhooks.create") }));

      const panel = await screen.findByTestId("qcms-webhook-secret");
      await user.click(within(panel).getByRole("button", { name: t("ops.common.copy") }));

      // The secret is on screen exactly once and can never be produced again (SEC-6), so a
      // refusal an operator cannot see is the worst version of this failure in the app.
      expect(await screen.findByText(t("ops.common.copyFailed"))).toBeTruthy();
    });
  },
);
