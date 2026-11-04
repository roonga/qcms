import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WebhookConfig, type WebhookActionState } from "./webhook-config.tsx";
import { t } from "../../lib/i18n/en.ts";
import { readResult } from "../../lib/server/api-result.ts";
import type { WebhookSummary } from "../../lib/ops/types.ts";

const HOOK: WebhookSummary = {
  webhookId: "whk_1",
  url: "https://example.test/hook",
  active: true,
  deactivatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function rejection(details: Record<string, unknown>, message = "server prose"): Response {
  return new Response(
    JSON.stringify({ error: { code: "WEBHOOK_URL_REJECTED", message, details } }),
    {
      status: 422,
      headers: { "content-type": "application/json" },
    },
  );
}

async function createFailure(response: Response): Promise<WebhookActionState> {
  const result = await readResult<never>(response);
  if (result.ok) throw new Error("expected a refusal");
  return { status: "error", message: t("ops.webhooks.createFailed", { message: result.message }) };
}

function idle(): Promise<{ readonly status: "idle" }> {
  return Promise.resolve({ status: "idle" });
}

async function attempt(response: Response, url: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  render(
    <WebhookConfig
      webhooks={{ ok: true, data: [HOOK] }}
      create={() => createFailure(response)}
      rotate={idle}
      deactivate={idle}
      reactivate={idle}
      retarget={idle}
    />,
  );

  await user.click(screen.getByRole("button", { name: t("ops.webhooks.add") }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByRole("textbox", { name: t("ops.webhooks.url") }), url);
  await user.click(within(dialog).getByRole("button", { name: t("ops.webhooks.create") }));
  return dialog;
}

describe("a webhook URL the SSRF guard refused", { timeout: 30_000 }, () => {
  it("says the target was not a complete URL", async () => {
    const dialog = await attempt(rejection({ reason: "not-a-url" }), "example.test/hook");
    expect(
      await within(dialog).findByText(
        t("ops.webhooks.createFailed", { message: t("ops.error.webhookUrlNotAbsolute") }),
      ),
    ).toBeTruthy();
  });

  it("says the scheme is not one this deployment delivers over", async () => {
    const dialog = await attempt(rejection({ reason: "unsupported-scheme" }), "ftp://x.test/hook");
    expect(
      await within(dialog).findByText(
        t("ops.webhooks.createFailed", { message: t("ops.error.webhookUrlScheme") }),
      ),
    ).toBeTruthy();
  });

  it("says https is required, without naming the flag that lifts it", async () => {
    const dialog = await attempt(rejection({ reason: "https-required" }), "http://x.test/hook");
    expect(
      await within(dialog).findByText(
        t("ops.webhooks.createFailed", { message: t("ops.error.webhookUrlHttpsRequired") }),
      ),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain("QCMS_");
  });

  it("says the address is private or reserved", async () => {
    const dialog = await attempt(rejection({ reason: "private-host" }), "https://10.1.2.3/hook");
    expect(
      await within(dialog).findByText(
        t("ops.webhooks.createFailed", { message: t("ops.error.webhookUrlPrivateHost") }),
      ),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain("QCMS_");
  });

  it("falls back to the sentence true of all four when the envelope names no reason", async () => {
    const dialog = await attempt(rejection({}), "https://x.test/hook");
    expect(
      await within(dialog).findByText(
        t("ops.webhooks.createFailed", { message: t("ops.error.webhookUrlRejected") }),
      ),
    ).toBeTruthy();
  });

  it("renders none of the response body it was refused with (SEC-8)", async () => {
    const dialog = await attempt(
      rejection(
        { reason: "private-host", secret: "whsec_should_never_render" },
        "The webhook URL resolves to a private or reserved host",
      ),
      "https://127.0.0.1/hook",
    );

    expect(
      await within(dialog).findByText(
        t("ops.webhooks.createFailed", { message: t("ops.error.webhookUrlPrivateHost") }),
      ),
    ).toBeTruthy();
    const rendered = dialog.textContent ?? "";
    expect(rendered).not.toContain("whsec_");
    expect(rendered).not.toContain("resolves to a private");
  });
});
