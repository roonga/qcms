import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AccountMenu } from "./account-menu.tsx";

async function openMenu(name?: string): Promise<HTMLElement> {
  render(<AccountMenu email="priya.shah@qcms.test" {...(name === undefined ? {} : { name })} />);
  await userEvent.setup().click(screen.getByRole("button"));
  return screen.findByRole("menu");
}

describe("the account menu", () => {
  it("offers My account, My access and Sign out, in that order", async () => {
    const menu = await openMenu("Priya Shah");
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'), (item) =>
      item.textContent?.trim(),
    );
    expect(items).toStrictEqual(["My account", "My access", "Sign out"]);
    expect(screen.getByRole("menuitem", { name: "My account" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getByRole("menuitem", { name: "My access" })).toHaveAttribute(
      "href",
      "/me/access",
    );
  });

  it("names the account above its items, by display name and address", async () => {
    await openMenu("Priya Shah");
    expect(document.querySelector(".qcms-menu__who")?.textContent).toBe("Priya Shah");
    expect(document.querySelector(".qcms-menu__email")?.textContent).toBe("priya.shah@qcms.test");
  });

  it("falls back to the address alone when the account has no display name", async () => {
    await openMenu();
    expect(document.querySelector(".qcms-menu__who")?.textContent).toBe("Signed in as");
  });
});
