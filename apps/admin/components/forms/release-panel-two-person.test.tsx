import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ReleasePanel } from "./release-panel.tsx";
import type { ReleaseRecord } from "../../lib/forms/releases.ts";
import { t } from "../../lib/i18n/en.ts";

/**
 * What the release dialog says about the two-person rule before anything is pressed
 * (ADR-41's release rule, Q13, Q30, Q51; task 070).
 *
 * The rule is enforced by the API and this file asserts **none** of that. What it asserts
 * is the thing a 403 cannot do: tell an operator, while the dialog is open and the version
 * is selected, that this particular release is one they cannot make and why. A screen that
 * only reported the refusal afterwards would satisfy every API test and teach the operator
 * the rule by refusing them in production.
 *
 * Three readings, and they are not interchangeable:
 *
 *   - the operator **published** this version, so the act is refused and the button is
 *     disabled;
 *   - the version's author is **unknown**, so the rule cannot be checked;
 *   - somebody else published it, so this operator **is** the second account.
 *
 * And the fourth case, which is the one that protects Q13's default: with the switch off,
 * or outside `prod`, the dialog says nothing about any of it.
 */

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

/**
 * Whether the dialog's confirm control is refused.
 *
 * Read off the element rather than through a matcher this project does not load, and both
 * spellings are checked because the kit's `Button` is a React Aria control: it renders
 * `disabled` on a real `button` and `aria-disabled` where it keeps the element focusable,
 * and a test that knew only one of those would pass against a control that was still
 * pressable.
 */
function isDisabled(name: string): boolean {
  const button = screen.getByRole("button", { name });
  return button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true";
}

/** Open the release dialog on one environment, with one two-person input set. */
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
      // Newest first, so version 3 is what the dialog opens on.
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
    // Disabled rather than left to fail: the API refuses this exact pair, and a button
    // certain to be refused is one that teaches the rule by refusing.
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
    // The positive control. Without it the case above would pass against a dialog that
    // disabled the button for everybody.
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

    // Not a weaker claim than it looks: the author is this operator and the environment is
    // production, so the only thing keeping the notice away is the switch.
    expect(screen.queryByTestId("qcms-release-two-person")).toBeNull();
    expect(isDisabled(t("forms.releases.confirm", { environment: "prod" }))).toBe(false);
  });

  it("says nothing outside prod, whatever the switch says (criterion 4)", async () => {
    await openDialog("test", { required: true, viewer: VIEWER, authorOf: { "3": VIEWER } });

    // The rule gates `prod` alone (finding 5), which is what keeps a test cycle usable:
    // the author releasing their own version into `test` is the ordinary shape of one.
    expect(screen.queryByTestId("qcms-release-two-person")).toBeNull();
    expect(isDisabled(t("forms.releases.confirm", { environment: "test" }))).toBe(false);
  });
});
