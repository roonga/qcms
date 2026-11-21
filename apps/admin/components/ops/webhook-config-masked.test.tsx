import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WebhookConfig } from "./webhook-config.tsx";
import { t } from "../../lib/i18n/en.ts";
import type { WebhookSummary } from "../../lib/ops/types.ts";

function hook(url: string): WebhookSummary {
  return {
    webhookId: "whk_1",
    url,
    active: true,
    deactivatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function idle(): Promise<{ readonly status: "idle" }> {
  return Promise.resolve({ status: "idle" });
}

function renderWith(url: string) {
  render(
    <WebhookConfig
      webhooks={{ ok: true, data: [hook(url)] }}
      create={idle}
      rotate={idle}
      deactivate={idle}
      reactivate={idle}
      retarget={idle}
    />,
  );
}

describe("an endpoint URL the API masked", () => {
  it("says the query string is hidden, and who sees the whole address", () => {
    renderWith("https://hooks.example.org/intake?(hidden)");
    expect(screen.getByTestId("qcms-webhook-url-masked").textContent).toBe(
      t("ops.webhooks.maskedNote"),
    );
  });

  it("says nothing of a whole address", () => {
    renderWith("https://hooks.example.org/intake?key=1");
    expect(screen.queryByTestId("qcms-webhook-url-masked")).toBeNull();
  });
});
