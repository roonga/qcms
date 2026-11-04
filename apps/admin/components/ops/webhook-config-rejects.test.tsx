import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { WebhookConfig } from "./webhook-config.tsx";
import { t } from "../../lib/i18n/en.ts";
import type { WebhookSummary } from "../../lib/ops/types.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

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

    /* Override clipboard after userEvent.setup; absent clipboard access throws synchronously before a promise
       catch can run. */
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

      expect(await screen.findByText(t("ops.common.copyFailed"))).toBeTruthy();
    });
  },
);
