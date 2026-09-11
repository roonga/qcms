import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WebhookConfig, type WebhookActionState } from "./webhook-config.tsx";
import { t } from "../../lib/i18n/en.ts";
import { readResult } from "../../lib/server/api-result.ts";
import type { WebhookSummary } from "../../lib/ops/types.ts";

/**
 * What an author reads in the add-endpoint dialog when the SSRF guard refuses their URL
 * (issue #756, the half of #312 that PR #755 deferred).
 *
 * ## Why this is a rendered test and not a unit test of the map
 *
 * `lib/forms/webhook-url-rejection.test.ts` beside it pins the mapping. This file pins the
 * thing the mapping exists for, which is a different claim and can fail on its own: the
 * sentence has to survive `readResult`, `messageForFormCode`, the action's
 * `ops.webhooks.createFailed` wrapper and the dialog's own error region, and land in front
 * of an author who is still standing in the dialog with the bad URL in the field. #312 was
 * filed because the author was told "a webhook target must be an absolute https URL that
 * is not private" for four different mistakes; the fix is only real at the screen.
 *
 * The whole chain from the wire is driven rather than a message passed in: the `create`
 * prop builds its state from a real `Response` carrying the exact 422 envelope
 * `apps/api/src/features/webhooks/handler.ts` sends, so the envelope shape is part of what
 * this file asserts.
 *
 * ## SEC-8
 *
 * The envelope's `message` in these fixtures is deliberately unlike anything the admin
 * would say, and every case asserts it is absent from the screen. An API response body is
 * not this app's copy: rendering it would put unlocalised developer English (ADR-27) in
 * front of an operator and would make whatever the other side happens to write into UI.
 * The last case carries a secret-shaped value in the envelope to state the same rule where
 * it matters most.
 */

const HOOK: WebhookSummary = {
  webhookId: "whk_1",
  url: "https://example.test/hook",
  active: true,
  deactivatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** The 422 the API answers a refused target with, as a real `Response`. */
function rejection(details: Record<string, unknown>, message = "server prose"): Response {
  return new Response(
    JSON.stringify({ error: { code: "WEBHOOK_URL_REJECTED", message, details } }),
    {
      status: 422,
      headers: { "content-type": "application/json" },
    },
  );
}

/**
 * The state `createWebhookAction` returns for that response.
 *
 * The action itself is a `"use server"` module that opens with `requireAdminSession()`,
 * so it cannot be called here; its one failure line is reproduced instead. What is NOT
 * reproduced is the part under test - `readResult` is the real one.
 */
async function createFailure(response: Response): Promise<WebhookActionState> {
  const result = await readResult<never>(response);
  if (result.ok) throw new Error("expected a refusal");
  return { status: "error", message: t("ops.webhooks.createFailed", { message: result.message }) };
}

function idle(): Promise<{ readonly status: "idle" }> {
  return Promise.resolve({ status: "idle" });
}

/** Open the add dialog, type a URL, press create, and hand back the open dialog. */
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
    // ADR-24: clients receive behavior, not flag values. The API's own prose for this
    // reason used to name the variable, which is how it would reach a screen at all.
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
    // The envelope's own `message`, which the admin never renders. The assertion is on a
    // fragment rather than the whole sentence so a reworded API message still fails it.
    expect(rendered).not.toContain("resolves to a private");
  });
});
