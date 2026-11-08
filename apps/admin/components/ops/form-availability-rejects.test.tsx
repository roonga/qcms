import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FormAvailability } from "./form-availability.tsx";
import { t } from "../../lib/i18n/en.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

function transportFailure(): Promise<never> {
  return Promise.reject(new TypeError("fetch failed"));
}

describe("a rejected availability act", () => {
  it("says the status did not change, and keeps the lifecycle dialog open to say it", async () => {
    const user = userEvent.setup();
    render(
      <FormAvailability
        slug="intake"
        status="open"
        setStatus={transportFailure}
        environment="prod"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: t("forms.lifecycle.close", { environment: "prod" }) }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      await screen.findByRole("button", {
        name: t("forms.lifecycle.confirmClose", { environment: "prod" }),
      }),
    );

    expect(
      await within(dialog).findByText(t("forms.lifecycle.failed", { message: unexpected() })),
    ).toBeTruthy();
    expect(dialog.isConnected).toBe(true);
  });
});
