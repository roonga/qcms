import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DeadLetters } from "./dead-letters.tsx";
import { t } from "../../lib/i18n/en.ts";
import type { DeadLetterItem } from "../../lib/ops/types.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

const ROW: DeadLetterItem = {
  deliveryId: "dlv_1",
  eventId: "evt_1",
  eventType: "response.submitted",
  webhookId: "whk_1",
  formId: "form-1",
  url: "https://example.test/hook",
  attempts: 5,
  lastError: "502 Bad Gateway",
  deadLetteredAt: "2026-01-02T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("a rejected redelivery", () => {
  it("says the redelivery failed and hands the row's button back", async () => {
    const user = userEvent.setup();
    render(
      <DeadLetters
        deadLetters={{ ok: true, data: [ROW] }}
        redeliver={() => Promise.reject(new TypeError("fetch failed"))}
        redeliverAll={() => Promise.resolve({ status: "idle" })}
      />,
    );

    const redeliver = screen.getByRole("button", {
      name: t("ops.deadLetters.redeliverOne", { event: ROW.eventType, target: ROW.url }),
    });
    await user.click(redeliver);

    expect(
      await screen.findByText(t("ops.deadLetters.redeliverFailed", { message: unexpected() })),
    ).toBeTruthy();
    expect(redeliver.hasAttribute("disabled")).toBe(false);
  });
});
