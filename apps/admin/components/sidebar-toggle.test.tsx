import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { HideSidebarButton, ShowSidebarButton, SidebarProvider } from "./sidebar-toggle.tsx";
import { t, tPlural } from "../lib/i18n/en.ts";
import {
  SIDEBAR_ATTRIBUTE,
  SIDEBAR_COOKIE,
  SIDEBAR_HOLD_ATTRIBUTE,
  parseSidebarSetting,
  sidebarHidden,
} from "../lib/sidebar.ts";

/**
 * The operator's Hide sidebar (§7.0 ruling 8).
 *
 * What the rail then looks like is CSS keyed off the attribute, so the browser suite owns
 * the geometry. What is here is the pair's own contract: the attribute, the cookie, where
 * focus lands, and that a hold leaves the operator's setting alone.
 */

function toggles(setting: "shown" | "hidden" = "shown", filterCount = 0) {
  return render(
    <SidebarProvider setting={setting} secureCookies={false}>
      <ShowSidebarButton filterCount={filterCount} />
      <HideSidebarButton />
    </SidebarProvider>,
  );
}

afterEach(() => {
  document.documentElement.removeAttribute(SIDEBAR_ATTRIBUTE);
  document.documentElement.removeAttribute(SIDEBAR_HOLD_ATTRIBUTE);
  document.cookie = `${SIDEBAR_COOKIE}=; Path=/; Max-Age=0`;
});

describe("the sidebar toggles", () => {
  it("hides on Hide, remembers it, and moves focus to the way back", async () => {
    const user = userEvent.setup();
    toggles();
    await user.click(screen.getByTestId("qcms-hide-sidebar"));

    expect(document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("hidden");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=hidden`);
    expect(document.activeElement).toBe(screen.getByTestId("qcms-show-sidebar"));
    expect(screen.getByTestId("qcms-show-sidebar").getAttribute("aria-expanded")).toBe("false");
  });

  it("shows on Show, and moves focus back to Hide", async () => {
    const user = userEvent.setup();
    toggles("hidden");
    await user.click(screen.getByTestId("qcms-show-sidebar"));

    expect(document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("shown");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=shown`);
    expect(document.activeElement).toBe(screen.getByTestId("qcms-hide-sidebar"));
  });

  it("carries the filter count on the way back, and nothing when none is set", () => {
    toggles("hidden");
    expect(screen.getByTestId("qcms-show-sidebar").textContent).toBe(t("rail.show"));
    screen.getByTestId("qcms-show-sidebar").remove();

    toggles("hidden", 2);
    expect(screen.getByTestId("qcms-show-sidebar").textContent).toBe(
      t("rail.show.filtered", {
        filters: tPlural("rail.show.oneFilter", "rail.show.filters", 2),
      }),
    );
  });

  it("keeps the operator's setting out of a temporary hold", () => {
    // The hold is task 082's seam: it hides the rail while something else needs the width
    // and writes no cookie, so releasing it returns the operator's own choice.
    expect(sidebarHidden("shown", true)).toBe(true);
    expect(sidebarHidden("shown", false)).toBe(false);
    expect(sidebarHidden("hidden", false)).toBe(true);
    expect(parseSidebarSetting(undefined)).toBe("shown");
    expect(parseSidebarSetting("nonsense")).toBe("shown");
    expect(parseSidebarSetting("hidden")).toBe("hidden");
  });
});
