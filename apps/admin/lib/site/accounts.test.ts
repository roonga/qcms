import { describe, expect, it } from "vitest";

import { t } from "../i18n/en.ts";
import {
  accountControls,
  accountDirectoryQuery,
  accountErrorMessage,
  accountsPageHref,
  createAccountErrorMessage,
  heldGroupLabel,
  holdingsByWorkspace,
  lastAdministratorWorkspaces,
  readAccountFilters,
  type Account,
  type AccountHoldings,
} from "./accounts.ts";

const VIEWER = "usr_viewer";

function account(overrides: Partial<Account> = {}): Account {
  return {
    userId: "usr_target",
    email: "target@example.test",
    name: "Target",
    siteAdministrator: false,
    status: "active",
    ...overrides,
  };
}

describe("the directory filters", () => {
  it("reads search, status, the Site administrator filter and the page, dropping what is not offered", () => {
    expect(
      readAccountFilters({
        q: "  ada ",
        status: "unclaimed",
        role: "site-administrator",
        page: "3",
      }),
    ).toEqual({
      search: "ada",
      status: "unclaimed",
      siteAdministrators: true,
      page: 3,
      activeCount: 3,
    });
    expect(readAccountFilters({ status: "suspended", role: "owner", page: "0" })).toEqual({
      search: "",
      status: undefined,
      siteAdministrators: false,
      page: 1,
      activeCount: 0,
    });
    expect(readAccountFilters({ q: "x".repeat(300) }).search).toHaveLength(200);
  });

  it("asks the API for one page of 25 and keeps the filters across the pager", () => {
    const filters = readAccountFilters({ q: "a&b", status: "disabled", page: "2" });
    expect(accountDirectoryQuery(filters)).toBe("?q=a%26b&status=disabled&page=2&pageSize=25");
    expect(accountsPageHref(filters, 3)).toBe("/site/accounts?q=a%26b&status=disabled&page=3");
    expect(accountsPageHref(readAccountFilters({}), 1)).toBe("/site/accounts");
  });
});

describe("the acts the account page offers", () => {
  const viewer = (activeSiteAdministrators: number) => ({
    userId: VIEWER,
    activeSiteAdministrators,
  });

  it("offers resend and disable on an unclaimed account, and no reset", () => {
    const controls = accountControls(account({ status: "unclaimed" }), viewer(1));
    expect(controls.resend).toBe(true);
    expect(controls.reset).toEqual({ shown: false });
    expect(controls.disable).toEqual({ shown: true });
    expect(controls.reactivate).toBe(false);
  });

  it("offers only reactivate on a disabled account", () => {
    const controls = accountControls(account({ status: "disabled" }), viewer(1));
    expect(controls).toMatchObject({
      resend: false,
      reset: { shown: false },
      disable: { shown: false },
      reactivate: true,
    });
  });

  it("offers reset and disable on an active account, with no step-up for an ordinary one", () => {
    const controls = accountControls(account(), viewer(1));
    expect(controls).toMatchObject({
      reset: { shown: true },
      disable: { shown: true },
      stepUp: false,
      approval: "none",
    });
  });

  it("blocks disable and reset of the last active Site administrator, with that reason", () => {
    const controls = accountControls(
      account({ userId: VIEWER, siteAdministrator: true }),
      viewer(1),
    );
    expect(controls.disable).toEqual({ shown: true, blocked: "lastSiteAdministrator" });
    expect(controls.reset).toEqual({ shown: true, blocked: "lastSiteAdministrator" });
  });

  it("blocks acts on the viewer's own account while other Site administrators exist", () => {
    const controls = accountControls(
      account({ userId: VIEWER, siteAdministrator: true }),
      viewer(3),
    );
    expect(controls.disable).toEqual({ shown: true, blocked: "ownAccount" });
  });

  it("asks for a step-up alone with two Site administrators, and an approver from three", () => {
    const target = account({ siteAdministrator: true });
    expect(accountControls(target, viewer(2))).toMatchObject({
      stepUp: true,
      approval: "stepUpAlone",
      disable: { shown: true },
    });
    expect(accountControls(target, viewer(3)).approval).toBe("needsApprover");
    expect(
      accountControls(account({ siteAdministrator: true, status: "unclaimed" }), viewer(2))
        .approval,
    ).toBe("needsApprover");
  });
});

const HOLDINGS: AccountHoldings = {
  groups: [
    {
      workspaceId: "wsp_f",
      workspaceName: "Finance",
      groupId: "grp_a",
      groupName: "Authors",
      roles: ["forms.editor"],
      environments: [],
      suspended: false,
    },
    {
      workspaceId: "wsp_c",
      workspaceName: "Clinical",
      groupId: "grp_r",
      groupName: "Response viewers",
      roles: ["responses.viewer"],
      environments: ["prod"],
      suspended: true,
    },
  ],
  administratorOf: [
    { workspaceId: "wsp_c", workspaceName: "Clinical", last: true },
    { workspaceId: "wsp_b", workspaceName: "Billing", last: false },
  ],
};

describe("what the account holds", () => {
  it("groups the holdings by workspace in name order, administrator role first", () => {
    const held = holdingsByWorkspace(HOLDINGS);
    expect(held.map((entry) => entry.workspaceName)).toEqual(["Billing", "Clinical", "Finance"]);
    expect(held[1]).toMatchObject({ administrator: true, lastAdministrator: true });
    expect(held[1]?.groups.map((group) => group.groupName)).toEqual(["Response viewers"]);
    expect(held[2]).toMatchObject({ administrator: false });
  });

  it("names a group with its environments only where a role uses them", () => {
    const [authors, viewers] = HOLDINGS.groups;
    if (authors === undefined || viewers === undefined) throw new Error("fixture");
    expect(heldGroupLabel(authors, "en-GB")).toBe("Authors");
    expect(heldGroupLabel(viewers, "en-GB")).toBe("Response viewers (Production)");
  });

  it("lists the workspaces a disable leaves with no Workspace administrator", () => {
    expect(lastAdministratorWorkspaces(HOLDINGS)).toEqual(["Clinical"]);
  });
});

describe("refusals", () => {
  it("names the rule from the catalog, never the API's own text", () => {
    expect(accountErrorMessage("LAST_SITE_ADMINISTRATOR")).toBe(
      t("site.accounts.error.lastSiteAdministrator"),
    );
    expect(accountErrorMessage("STEP_UP_FAILED")).toBe(t("site.accounts.error.stepUpFailed"));
    expect(accountErrorMessage("SOMETHING_NEW")).toBe(t("site.accounts.error.other"));
  });

  it("names a duplicate address on create, and falls back to the shared copy", () => {
    expect(createAccountErrorMessage("ACCOUNT_EXISTS")).toBe(
      "An account already uses that address.",
    );
    expect(createAccountErrorMessage("MAIL_NOT_CONFIGURED")).toBe(
      t("site.accounts.create.mailNotConfigured"),
    );
    expect(createAccountErrorMessage("ACCOUNT_BUSY")).toBe(t("site.accounts.error.busy"));
  });
});
