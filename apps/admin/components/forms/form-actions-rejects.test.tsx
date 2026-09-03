import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FormActions } from "./form-actions.tsx";
import { IDLE_FORM_STATUS, IDLE_PUBLISH } from "../../lib/forms/builder-state.ts";
import type { DraftForm } from "../../lib/forms/types.ts";
import { t } from "../../lib/i18n/en.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

/**
 * What an author sees when a form-level action REJECTS rather than returning a failure
 * (issue #352, handlers 4 and 5 of nine).
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

const DRAFT: DraftForm = {
  formId: "form-1",
  defaultLocale: "en",
  title: { en: "Intake" },
  steps: [{ stepId: "step-1", title: { en: "About you" }, items: [] }],
  rules: [],
};

/** The rejection an unreachable API produces, which is the whole subject here. */
function transportFailure(): Promise<never> {
  return Promise.reject(new TypeError("fetch failed"));
}

describe("a rejected form-level action", () => {
  it("says the form was not published, and closes the publish dialog", async () => {
    const user = userEvent.setup();
    render(
      <FormActions
        slug="intake"
        formId="form-1"
        status="open"
        draft={DRAFT}
        latestVersion={1}
        publish={transportFailure}
        setStatus={() => Promise.resolve(IDLE_FORM_STATUS)}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.publish.action") }));
    await user.click(
      await screen.findByRole("button", { name: t("forms.publish.confirm", { version: 2 }) }),
    );

    expect(
      await screen.findByText(t("forms.publish.failed", { message: unexpected() })),
    ).toBeTruthy();
    // Closed on this path for the same reason it closes on success: the publish result
    // banner lives on the page behind it, so a dialog left up would hide the sentence.
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("says the status did not change, and keeps the lifecycle dialog open to say it", async () => {
    const user = userEvent.setup();
    render(
      <FormActions
        slug="intake"
        formId="form-1"
        status="open"
        draft={DRAFT}
        latestVersion={1}
        publish={() => Promise.resolve(IDLE_PUBLISH)}
        setStatus={transportFailure}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.lifecycle.close") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      await screen.findByRole("button", { name: t("forms.lifecycle.confirmClose") }),
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
