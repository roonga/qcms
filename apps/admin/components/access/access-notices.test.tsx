import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n/en";
import { NO_ACCESS_CAPABILITIES, type AccessCapabilities } from "@/lib/membership/access-patterns";
import { MY_ACCESS_PATH } from "@/lib/shell/modes";

import { NoAccessHome } from "./no-access-home";
import { UncoveredNotice } from "./uncovered-notice";

const MANAGES_ACCESS: AccessCapabilities = new Set(["access.read", "access.manage"]);

describe("the no access yet home", () => {
  it("names the Site administrator and links to My access", () => {
    render(
      <NoAccessHome
        siteAdministrators={[{ name: "Sam Okafor", email: "sam.okafor@qcms.test" }]}
        locale="en-GB"
      />,
    );
    const home = screen.getByRole("region", { name: t("access.noAccess.heading") });
    expect(home.textContent).toContain(
      "Your Site administrator is Sam Okafor (sam.okafor@qcms.test). A Workspace administrator adds you to an access group.",
    );
    expect(
      within(home)
        .getByRole("link", { name: t("access.title") })
        .getAttribute("href"),
    ).toBe(MY_ACCESS_PATH);
  });

  it("links to the My access section in place when it is shown on My access itself", () => {
    render(
      <NoAccessHome siteAdministrators={[]} locale="en-GB" accessHref="#qcms-my-access-heading" />,
    );
    expect(screen.getByRole("link", { name: t("access.title") }).getAttribute("href")).toBe(
      "#qcms-my-access-heading",
    );
  });

  it("names every Site administrator when there are several", () => {
    render(
      <NoAccessHome
        siteAdministrators={[
          { name: "Sam Okafor", email: "sam@qcms.test" },
          { name: "Luis Ortega", email: "luis@qcms.test" },
        ]}
        locale="en-GB"
      />,
    );
    expect(screen.getByTestId("qcms-no-access-home").textContent).toContain(
      "Your Site administrators are Sam Okafor (sam@qcms.test) and Luis Ortega (luis@qcms.test).",
    );
  });

  it("still says who grants access when no Site administrator can be named", () => {
    render(<NoAccessHome siteAdministrators={[]} locale="en-GB" />);
    expect(screen.getByTestId("qcms-no-access-home").textContent).toContain(
      t("access.noAccess.administrator.none"),
    );
  });
});

describe("the no group covers this notice", () => {
  it("names a new environment and links to adding it to a group", () => {
    render(
      <UncoveredNotice
        uncovered={{ roles: [], environments: ["staging"] }}
        capabilities={MANAGES_ACCESS}
        addHref="/workspaces/ws_1/access-groups/new"
      />,
    );
    const notice = screen.getByRole("region", { name: t("access.uncovered.label") });
    expect(within(notice).getByRole("listitem").textContent).toBe(
      "Environment staging: no group covers it yet.",
    );
    expect(
      within(notice)
        .getByRole("link", { name: t("access.uncovered.add") })
        .getAttribute("href"),
    ).toBe("/workspaces/ws_1/access-groups/new");
  });

  it("names a role left uncovered after a group is deleted", () => {
    render(
      <UncoveredNotice
        uncovered={{ roles: ["responses.eraser"], environments: ["prod"] }}
        capabilities={MANAGES_ACCESS}
      />,
    );
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Environment prod: no group covers it yet.",
      "Erase responses: no group grants it yet.",
    ]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing while every role and environment is covered", () => {
    const { container } = render(
      <UncoveredNotice uncovered={{ roles: [], environments: [] }} capabilities={MANAGES_ACCESS} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders no link for a caller who cannot change access groups", () => {
    render(
      <UncoveredNotice
        uncovered={{ roles: [], environments: ["staging"] }}
        capabilities={NO_ACCESS_CAPABILITIES}
        addHref="/workspaces/ws_1/access-groups/new"
      />,
    );
    expect(screen.getByRole("region").textContent).toContain(
      "Environment staging: no group covers it yet.",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
