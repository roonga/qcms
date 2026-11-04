import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ReleasePanel } from "./release-panel.tsx";
import type { ReleaseRecord } from "../../lib/forms/releases.ts";
import { t } from "../../lib/i18n/en.ts";

const VIEWER = "au_second_approver";
const AUTHOR = "au_author";

const HISTORY: readonly ReleaseRecord[] = [
  {
    formId: "frm_intake",
    environment: "prod",
    version: 1,
    sequence: 1,
    fromEnvironment: null,
    releasedBy: AUTHOR,
    releasedAt: "2026-10-01T00:00:00.000Z",
    approvedBy: null,
    replacedVersion: null,
    rollback: false,
    closed: false,
  },
];

function isDisabled(name: string): boolean {
  const button = screen.getByRole("button", { name });
  return button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true";
}

async function openDialog(
  selectedEnvironment: string,
  twoPerson: {
    readonly required: boolean;
    readonly viewer: string;
    readonly authorOf: Readonly<Record<string, string | null>>;
  },
): Promise<void> {
  const user = userEvent.setup();
  render(
    <ReleasePanel
      releases={HISTORY}
      versions={[3, 2, 1]}
      environments={["test", "prod"]}
      selectedEnvironment={selectedEnvironment}
      release={() => Promise.resolve({ status: "idle" as const })}
      twoPerson={twoPerson}
    />,
  );
  await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
  await screen.findByRole("alertdialog");
}

describe("the release dialog and the two-person rule", () => {
  it("refuses the version's own author, and disables the act", async () => {
    await openDialog("prod", {
      required: true,
      viewer: VIEWER,
      authorOf: { "3": VIEWER },
    });

    expect(screen.getByTestId("qcms-release-two-person").textContent).toContain(
      t("forms.releases.twoPersonSelf", { version: 3, environment: "prod" }),
    );
    expect(isDisabled(t("forms.releases.confirm", { environment: "prod" }))).toBe(true);
  });

  it("tells a different account that it is the second one, and leaves the act available", async () => {
    await openDialog("prod", {
      required: true,
      viewer: VIEWER,
      authorOf: { "3": AUTHOR },
    });

    expect(screen.getByTestId("qcms-release-two-person").textContent).toContain(
      t("forms.releases.twoPersonSecond", { environment: "prod" }),
    );
    expect(isDisabled(t("forms.releases.confirm", { environment: "prod" }))).toBe(false);
  });

  it("says the rule cannot be checked when the author is unknown", async () => {
    await openDialog("prod", { required: true, viewer: VIEWER, authorOf: { "3": null } });

    expect(screen.getByTestId("qcms-release-two-person").textContent).toContain(
      t("forms.releases.twoPersonUnknown", { version: 3 }),
    );
  });

  it("says nothing with the switch off, which is the default (criterion 3)", async () => {
    await openDialog("prod", { required: false, viewer: VIEWER, authorOf: { "3": VIEWER } });

    expect(screen.queryByTestId("qcms-release-two-person")).toBeNull();
    expect(isDisabled(t("forms.releases.confirm", { environment: "prod" }))).toBe(false);
  });

  it("says nothing outside prod, whatever the switch says (criterion 4)", async () => {
    await openDialog("test", { required: true, viewer: VIEWER, authorOf: { "3": VIEWER } });

    expect(screen.queryByTestId("qcms-release-two-person")).toBeNull();
    expect(isDisabled(t("forms.releases.confirm", { environment: "test" }))).toBe(false);
  });
});
