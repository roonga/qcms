import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Menu, MenuItemText } from "./kit.ts";
import { axeViolations } from "./test-support/a11y.ts";

// The vendored Menu takes a row's content as a node, so a second line is composed from the
// stack's own slots rather than from a kit prop the registry does not ship.
function row(name: string, meaning: string) {
  return {
    id: name,
    textValue: name,
    label: (
      <>
        <MenuItemText slot="label">{name}</MenuItemText>
        <MenuItemText slot="description">{meaning}</MenuItemText>
      </>
    ),
  };
}

function EnvironmentHarness() {
  return (
    <Menu
      triggerLabel="Environment: prod. Change environment"
      trigger={<span>prod</span>}
      menuLabel="Environment"
      selectionMode="single"
      selectedKeys={["prod"]}
      header={<p>Applies to every Operations screen.</p>}
      items={[row("test", "Before prod"), row("prod", "Live forms")]}
    />
  );
}

describe("a menu row with a second line", () => {
  it("keeps the row's name its label and puts the meaning in its description", async () => {
    const user = userEvent.setup();
    render(<EnvironmentHarness />);
    await user.click(screen.getByRole("button"));

    const chosen = screen.getByRole("menuitemradio", { name: "prod" });
    const describes = chosen.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describes)?.textContent).toBe("Live forms");
    expect(screen.getByRole("menuitemradio", { name: "test" })).toBeTruthy();
  });

  it("leaves the note out of the rows the arrow keys walk", async () => {
    const user = userEvent.setup();
    render(<EnvironmentHarness />);
    await user.click(screen.getByRole("button"));

    const note = screen.getByText("Applies to every Operations screen.");
    expect(screen.getByRole("menu").contains(note)).toBe(false);
    expect(screen.getAllByRole("menuitemradio").length).toBe(2);
  });

  it("has zero axe violations with the rows open", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<EnvironmentHarness />);
    await user.click(screen.getByRole("button"));

    expect(await axeViolations(baseElement)).toEqual([]);
  });
});
