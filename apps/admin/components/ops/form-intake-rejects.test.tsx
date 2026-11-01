import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FormIntake } from "./form-intake.tsx";
import { t } from "../../lib/i18n/en.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

/**
 * What an operator sees when the intake act REJECTS rather than returning a failure
 * (issue #352, handler 6 of nine).
 *
 * It was `components/forms/form-actions-rejects.test.tsx` while close and reopen were the
 * builder's; they are Operations' since 2026-11-02 (Code Owner) and so is this.
 *
 * One handler is left here; the publish wizard's three are asserted in
 * `publish-wizard-rejects.test.tsx`.
 *
 * ## What is faked, and why it is the right edge
 *
 * The server action is a prop, so the fake is the prop and nothing else: the `.then`
 * chain, the `useTransition`, the state it sets and the markup that reads that state are
 * all the real component. `adminApiFetch` documents that it does not throw for a non-2xx,
 * which is true and is exactly the trap these handlers guard - a transport failure still
 * rejects with a `TypeError`, and `readResult`'s `response.json()` rejects on a truncated
 * body. Neither is a status the app can read, so neither reaches the `ApiResult` failure
 * shape the screen renders, and a `TypeError` is what the prop produces here.
 *
 * ## Why the assertion is not just "an error appeared"
 *
 * The regression these tests exist to catch is not a wrong message, it is NO message: a
 * rejected promise with no `.catch` sets no state at all, so the dialog stays exactly as
 * it was and the author reads it as a slow network. Each test therefore asserts both the
 * sentence and where the dialog ended up, because the second half is what tells them the
 * action is over.
 *
 * Vitest fails a file on an unhandled rejection, which is the other half of the guard and
 * needs no assertion: removing either `.catch` fails these tests twice over.
 */

/** The rejection an unreachable API produces, which is the whole subject here. */
function transportFailure(): Promise<never> {
  return Promise.reject(new TypeError("fetch failed"));
}

describe("a rejected form-level action", () => {
  it("says the status did not change, and keeps the lifecycle dialog open to say it", async () => {
    const user = userEvent.setup();
    render(
      <FormIntake slug="intake" status="open" setStatus={transportFailure} environment="prod" />,
    );

    // The labels name the environment the act lands in since task 066 (Q18): closing is
    // per (form, environment), so "Close form" would be ambiguous about where.
    await user.click(
      screen.getByRole("button", { name: t("forms.lifecycle.close", { environment: "prod" }) }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      await screen.findByRole("button", {
        name: t("forms.lifecycle.confirmClose", { environment: "prod" }),
      }),
    );

    // Scoped to the dialog, and that scope is the assertion: the sentence is on the page
    // behind it too, but a modal covers the page's alert region, so a failure written
    // only there is a failure the author cannot see. `within` is what tells the two
    // copies apart.
    expect(
      await within(dialog).findByText(t("forms.lifecycle.failed", { message: unexpected() })),
    ).toBeTruthy();
    expect(dialog.isConnected).toBe(true);
  });
});
