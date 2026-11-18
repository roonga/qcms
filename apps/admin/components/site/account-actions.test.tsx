import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n/en";
import { accountControls, type Account, type AccountActState } from "@/lib/site/accounts";

import { AccountActions } from "./account-actions";

const SAM: Account = {
  userId: "usr_sam",
  email: "sam@example.test",
  name: "Sam Okafor",
  siteAdministrator: true,
  status: "active",
};

const GRACE: Account = {
  userId: "usr_grace",
  email: "grace@example.test",
  name: "Grace Mensah",
  siteAdministrator: false,
  status: "active",
};

function isOff(button: HTMLElement): boolean {
  return button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true";
}

const done = (message: string): Promise<AccountActState> =>
  Promise.resolve({ status: "done", message });

function renderActions(
  account: Account,
  activeSiteAdministrators: number,
  overrides: Partial<Parameters<typeof AccountActions>[0]> = {},
) {
  return render(
    <AccountActions
      account={account}
      controls={accountControls(account, { userId: "usr_sam", activeSiteAdministrators })}
      holdingsSummary={["Clinical: Workspace administrator, Publishers (prod)"]}
      lastAdministratorOf={["Clinical"]}
      locale="en-GB"
      resend={() => done("resent")}
      disable={() => done("disabled")}
      reactivate={() => done("reactivated")}
      reset={() => done("reset")}
      {...overrides}
    />,
  );
}

describe("the account page's acts", () => {
  it("disables Disable account for the last active Site administrator and says why", () => {
    renderActions(SAM, 1);
    const disable = screen.getByRole("button", { name: t("site.accounts.disable.act") });
    expect(isOff(disable)).toBe(true);
    expect(
      screen.getByText(t("site.accounts.blocked.lastDisable", { person: "Sam Okafor" })),
    ).toBeTruthy();
  });

  it("confirms a disable with the holdings and the workspaces left without an administrator", async () => {
    const user = userEvent.setup();
    const disable = vi.fn(() => done(t("site.accounts.disable.done")));
    renderActions(GRACE, 2, { disable });
    await user.click(screen.getByRole("button", { name: t("site.accounts.disable.act") }));
    const dialog = await screen.findByRole("dialog", {
      name: t("site.accounts.disable.title", { name: "Grace Mensah" }),
    });
    expect(within(dialog).getByText(/Publishers \(prod\)/u)).toBeTruthy();
    expect(
      within(dialog).getByText(
        t("site.accounts.disable.lastAdministrator", { workspaces: "Clinical" }),
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByLabelText(t("site.stepUp.password"))).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: t("site.accounts.disable.act") }));
    await waitFor(() => {
      expect(disable).toHaveBeenCalledWith("usr_grace", undefined);
    });
    expect(await screen.findByText(t("site.accounts.disable.done"))).toBeTruthy();
  });

  it("asks a Site administrator's disable for a step-up, and keeps the dialog open on a refusal", async () => {
    const user = userEvent.setup();
    const target: Account = { ...GRACE, siteAdministrator: true };
    const disable = vi.fn((): Promise<AccountActState> =>
      Promise.resolve({
        status: "error",
        code: "STEP_UP_FAILED",
        message: t("site.accounts.error.stepUpFailed"),
      }),
    );
    renderActions(target, 3, { disable });
    await user.click(screen.getByRole("button", { name: t("site.accounts.disable.act") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(t("site.stepUp.needsApprover"))).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: t("site.accounts.disable.act") });
    expect(isOff(confirm)).toBe(true);
    await user.type(within(dialog).getByLabelText(/^Password/u), "secret-value");
    await user.type(within(dialog).getByLabelText(/^Second factor code/u), "123456");
    expect(isOff(confirm)).toBe(false);
    await user.click(confirm);
    await waitFor(() => {
      expect(disable).toHaveBeenCalledWith("usr_grace", {
        password: "secret-value",
        code: "123456",
      });
    });
    expect(await within(dialog).findByText(t("site.accounts.error.stepUpFailed"))).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("names the reset button by the choice and sends that choice", async () => {
    const user = userEvent.setup();
    const reset = vi.fn(() => done("reset"));
    renderActions(GRACE, 2, { reset });
    await user.click(screen.getByRole("button", { name: t("site.accounts.reset.open") }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: t("site.accounts.reset.actPassword") }),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("radio", { name: /^Second factor/u }));
    await user.click(
      within(dialog).getByRole("button", { name: t("site.accounts.reset.actFactor") }),
    );
    await waitFor(() => {
      expect(reset).toHaveBeenCalledWith("usr_grace", "factor", undefined);
    });
  });

  it("offers Resend link and Disable on an unclaimed account, and Reactivate alone on a disabled one", () => {
    const { unmount } = renderActions({ ...GRACE, status: "unclaimed" }, 2);
    expect(screen.getByRole("button", { name: t("site.accounts.resend.act") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("site.accounts.reset.open") })).toBeNull();
    unmount();
    renderActions({ ...GRACE, status: "disabled" }, 2);
    expect(screen.getByRole("button", { name: t("site.accounts.reactivate.act") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("site.accounts.disable.act") })).toBeNull();
  });
});
