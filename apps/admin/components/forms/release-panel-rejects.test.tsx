import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ReleasePanel } from "./release-panel.tsx";
import type { ReleaseRecord } from "../../lib/forms/releases.ts";
import { t } from "../../lib/i18n/en.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

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
    closed: false,
  },
];

const RULE_OFF = { required: false, viewer: "au_viewer", authorOf: {} } as const;

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
        twoPerson={RULE_OFF}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      await within(dialog).findByRole("button", {
        name: t("forms.releases.confirm", { environment: "test" }),
      }),
    );

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
        twoPerson={RULE_OFF}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
    const dialog = await screen.findByRole("alertdialog");
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
        selectedEnvironment="prod"
        release={() => Promise.resolve({ status: "idle" as const })}
        twoPerson={RULE_OFF}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
    const dialog = await screen.findByRole("alertdialog");
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
        twoPerson={RULE_OFF}
      />,
    );

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
        twoPerson={RULE_OFF}
      />,
    );

    const released = screen.getByTestId("qcms-released-now");
    const testRow = released.querySelector('tr[data-environment="test"]');
    expect(testRow?.textContent).toContain(t("forms.releases.none"));
    const prodRow = released.querySelector('tr[data-environment="prod"]');
    expect(prodRow?.textContent).toContain(t("forms.version.value", { version: 2 }));
  });
});
