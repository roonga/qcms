import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { RailFilters } from "@/components/rail-filters";
import { t } from "@/lib/i18n/en";
import { readAccessFilters } from "@/lib/membership/access-patterns";

import { AccessFilterFields, ResultPager } from "./access-filters";

const OPTIONS = {
  roles: ["forms.editor", "responses.viewer"],
  environments: ["test", "prod"],
  statuses: ["active", "suspended"] as const,
};

/* React Aria paints each option list in a popover (Playwright's layer, ADR-23); the select it keeps
   for form submission carries the same name, options and value. */
function nativeSelect(name: string): HTMLSelectElement {
  const field = document.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  if (field === null) throw new Error(`no select named ${name}`);
  return field;
}

function optionLabels(name: string): readonly string[] {
  return [...nativeSelect(name).options].map((option) => option.textContent ?? "");
}

describe("the search and rail filter primitives", () => {
  it("offers search, role, environment and status, each with its full label", () => {
    render(
      <RailFilters activeCount={0} clearHref="/workspaces/ws_1/members">
        <AccessFilterFields filters={readAccessFilters({}, OPTIONS)} {...OPTIONS} />
      </RailFilters>,
    );
    const form = screen.getByRole("search", { name: t("rail.filters") });
    const search = within(form).getByRole("textbox", { name: t("access.filter.search") });
    expect(search.getAttribute("name")).toBe("q");
    expect(search.getAttribute("placeholder")).toBe(t("access.filter.searchPlaceholder"));
    expect(optionLabels("role")).toContain("Edit forms");
    expect(optionLabels("role")).toContain(t("access.filter.any"));
    expect(optionLabels("environment")).toEqual(
      expect.arrayContaining([t("access.filter.any"), "test", "prod"]),
    );
    expect(optionLabels("status")).toEqual(
      expect.arrayContaining([t("access.filter.any"), "Active", "Suspended"]),
    );
    for (const label of [
      "access.filter.role",
      "access.filter.environment",
      "access.filter.status",
    ] as const) {
      expect(within(form).getAllByText(t(label)).length).toBeGreaterThan(0);
    }
  });

  it("shows the filters the query string chose", () => {
    render(
      <AccessFilterFields
        filters={readAccessFilters(
          { q: "priya", role: "responses.viewer", environment: "prod", status: "suspended" },
          OPTIONS,
        )}
        {...OPTIONS}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("priya");
    expect(nativeSelect("role").value).toBe("responses.viewer");
    expect(nativeSelect("environment").value).toBe("prod");
    expect(nativeSelect("status").value).toBe("suspended");
  });

  it("leaves out a filter the screen offers no options for", () => {
    render(<AccessFilterFields filters={readAccessFilters({}, OPTIONS)} statuses={["active"]} />);
    expect(document.querySelector('select[name="role"]')).toBeNull();
    expect(document.querySelector('select[name="environment"]')).toBeNull();
    expect(document.querySelector('select[name="status"]')).not.toBeNull();
  });

  it("is keyboard reachable from the search box to Apply", async () => {
    const user = userEvent.setup();
    render(
      <RailFilters activeCount={0} clearHref="/workspaces/ws_1/members">
        <AccessFilterFields filters={readAccessFilters({}, OPTIONS)} {...OPTIONS} />
      </RailFilters>,
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: t("access.filter.search") }),
    );
    const apply = screen.getByRole("button", { name: t("rail.filters.apply") });
    for (let step = 0; step < 6 && document.activeElement !== apply; step += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(apply);
  });
});

describe("the result pager", () => {
  const href = (page: number) => `/site/accounts?page=${page}`;

  it("states the range at scale and links only the pages that exist", () => {
    render(<ResultPager page={1} pageSize={25} total={1000} locale="en-GB" pageHref={href} />);
    const nav = screen.getByRole("navigation", { name: t("access.results.label") });
    expect(nav.textContent).toContain("1 to 25 of 1,000");
    expect(within(nav).queryByRole("link", { name: t("access.results.previous") })).toBeNull();
    expect(within(nav).getByText(t("access.results.previous")).getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(
      within(nav)
        .getByRole("link", { name: t("access.results.next") })
        .getAttribute("href"),
    ).toBe("/site/accounts?page=2");
  });

  it("links back from the last page and says when nothing matched", () => {
    const { unmount } = render(
      <ResultPager page={40} pageSize={25} total={1000} locale="en-GB" pageHref={href} />,
    );
    expect(
      screen.getByRole("link", { name: t("access.results.previous") }).getAttribute("href"),
    ).toBe("/site/accounts?page=39");
    expect(screen.queryByRole("link", { name: t("access.results.next") })).toBeNull();
    unmount();

    render(<ResultPager page={1} pageSize={25} total={0} locale="en-GB" pageHref={href} />);
    expect(screen.getByRole("navigation").textContent).toContain(t("access.results.none"));
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
});
