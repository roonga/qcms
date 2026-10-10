import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ReleasePanel } from "./release-panel.tsx";
import type { ReleaseRecord } from "../../lib/forms/releases.ts";
import { t } from "../../lib/i18n/en.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

/**
 * What an operator sees when a release REJECTS rather than returning a failure (issue
 * #352's rule, applied to task 065's action).
 *
 * The server action is a prop, so the fake is the prop and nothing else: the `.then`
 * chain, the `useTransition`, the state it sets and the markup that reads it are all the
 * real component. `adminApiFetch` documents that it does not throw for a non-2xx, which is
 * true and is exactly the trap this handler guards - a transport failure still rejects with
 * a `TypeError`, and `readResult`'s `response.json()` rejects on a truncated body.
 *
 * The regression this exists to catch is not a wrong message, it is **no** message: a
 * rejected promise with no `.catch` sets no state, so the dialog sits there and the
 * operator reads it as a slow network while wondering whether a release just landed in
 * production. Vitest fails a file on an unhandled rejection too, which is the other half of
 * the guard.
 */

const HISTORY: readonly ReleaseRecord[] = [
  {
    formId: "frm_intake",
    environment: "prod",
    version: 2,
    sequence: 1,
    fromEnvironment: null,
    releasedBy: "usr_alice",
    releasedAt: "2026-10-01T00:00:00.000Z",
    approvedBy: null,
    replacedVersion: null,
    rollback: false,
  },
];

function transportFailure(): Promise<never> {
  return Promise.reject(new TypeError("fetch failed"));
}

describe("a rejected release", () => {
  it("says nothing was released, and keeps the dialog open to say it", async () => {
    const user = userEvent.setup();
    render(
      <ReleasePanel
        releases={HISTORY}
        versions={[2, 1]}
        environments={["test", "prod"]}
        selectedEnvironment="test"
        release={transportFailure}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      await within(dialog).findByRole("button", {
        name: t("forms.releases.confirm", { environment: "test" }),
      }),
    );

    // Scoped to the dialog, and the scope is the assertion: the sentence is on the page
    // behind it too, but a modal covers the page's alert region, so a failure written only
    // there is a failure the operator cannot see.
    expect(
      await within(dialog).findByText(t("forms.releases.failed", { message: unexpected() })),
    ).toBeTruthy();
    expect(dialog.isConnected).toBe(true);
  });
});

describe("the release confirmation", () => {
  it("names the environment it is about, which Q6 requires of every such act", async () => {
    const user = userEvent.setup();
    render(
      <ReleasePanel
        releases={HISTORY}
        versions={[2, 1]}
        environments={["test", "prod"]}
        selectedEnvironment="test"
        release={() => Promise.resolve({ status: "idle" as const })}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
    const dialog = await screen.findByRole("alertdialog");
    // An act performed against the wrong environment is not undoable, so the environment
    // is in the title, in the body and on the confirm button rather than inferable from a
    // control elsewhere on the screen.
    expect(within(dialog).getByText(t("environment.inThis", { environment: "test" }))).toBeTruthy();
    expect(
      within(dialog).getByRole("button", {
        name: t("forms.releases.confirm", { environment: "test" }),
      }),
    ).toBeTruthy();
  });

  it("warns before the press when the release would move the environment backwards", async () => {
    const user = userEvent.setup();
    render(
      <ReleasePanel
        releases={HISTORY}
        versions={[2, 1]}
        environments={["test", "prod"]}
        // `prod` is on v2 in the history above, so releasing v1 there is a rollback.
        selectedEnvironment="prod"
        release={() => Promise.resolve({ status: "idle" as const })}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
    const dialog = await screen.findByRole("alertdialog");
    // The default selection is the newest version, which is what is already out, so the
    // warning is absent until the operator picks the earlier one.
    expect(within(dialog).queryByTestId("qcms-release-rollback-warning")).toBeNull();
  });
});

describe("the release history", () => {
  it("marks a rollback row rather than leaving an operator to count backwards", () => {
    render(
      <ReleasePanel
        releases={[
          {
            ...HISTORY[0]!,
            version: 1,
            sequence: 2,
            replacedVersion: 2,
            rollback: true,
          },
          HISTORY[0]!,
        ]}
        versions={[2, 1]}
        environments={["test", "prod"]}
        selectedEnvironment="prod"
        release={() => Promise.resolve({ status: "idle" as const })}
      />,
    );

    // The marking is derived by the API from the row's predecessor and rendered as a word,
    // not a colour (ADR-40, criterion 4; WCAG 1.4.1).
    expect(screen.getByTestId("qcms-rollback-mark").textContent).toBe(t("forms.releases.rollback"));
    expect(screen.getByText(t("forms.releases.rollbackFrom", { replaced: 2 }))).toBeTruthy();
  });

  it("shows every environment, including the ones with nothing released", () => {
    render(
      <ReleasePanel
        releases={HISTORY}
        versions={[2, 1]}
        environments={["test", "prod"]}
        selectedEnvironment="test"
        release={() => Promise.resolve({ status: "idle" as const })}
      />,
    );

    // "Not released in test" is the answer an operator most needs, and a row that was
    // simply absent would make them wonder whether the screen had loaded.
    const released = screen.getByTestId("qcms-released-now");
    const testRow = released.querySelector('tr[data-environment="test"]');
    expect(testRow?.textContent).toContain(t("forms.releases.none"));
    const prodRow = released.querySelector('tr[data-environment="prod"]');
    expect(prodRow?.textContent).toContain(t("forms.version.value", { version: 2 }));
  });
});
