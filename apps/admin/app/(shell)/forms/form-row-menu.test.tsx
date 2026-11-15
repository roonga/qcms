import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { t } from "../../../lib/i18n/en.ts";

import { FormRowMenu } from "./form-row-menu.tsx";

const NAME = "Alpha form";

function trigger() {
  return screen.getByRole("button", { name: t("forms.rowActions", { name: NAME }) });
}

async function open(canOperate: boolean) {
  const user = userEvent.setup();
  render(<FormRowMenu formId="frm_alpha" name={NAME} canOperate={canOperate} />);
  await user.click(trigger());
  return user;
}

describe("the forms list row menu", () => {
  it("names its trigger by the row's own form, and says it opens a popup", () => {
    render(<FormRowMenu formId="frm_alpha" name={NAME} canOperate />);
    expect(trigger().getAttribute("aria-haspopup")).toBe("true");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("offers each action as a real link to the screen it opens", async () => {
    await open(true);
    const menu = screen.getByRole("menu");
    expect(menu.getAttribute("aria-label")).toBe(t("forms.rowActions", { name: NAME }));
    expect(
      screen.getByRole("menuitem", { name: t("forms.tab.builder") }).getAttribute("href"),
    ).toBe("/forms/frm_alpha");
    expect(
      screen.getByRole("menuitem", { name: t("forms.tab.preview") }).getAttribute("href"),
    ).toBe("/forms/frm_alpha/preview");
    expect(screen.getByRole("menuitem", { name: t("forms.tab.links") }).getAttribute("href")).toBe(
      "/operations/forms/frm_alpha/links",
    );
  });

  it("leaves out the Operations destination the caller's grants refuse", async () => {
    await open(false);
    expect(screen.queryByRole("menuitem", { name: t("forms.tab.links") })).toBeNull();
    expect(screen.getByRole("menuitem", { name: t("forms.tab.builder") })).toBeTruthy();
  });

  it("opens from the keyboard and walks its items with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<FormRowMenu formId="frm_alpha" name={NAME} canOperate />);

    trigger().focus();
    await user.keyboard("{Enter}");

    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toBe(document.activeElement);
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toBe(document.activeElement);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger());
    });
  });

  it("escapes a form id that would otherwise alter the destination path", async () => {
    const user = userEvent.setup();
    render(<FormRowMenu formId="frm a/b" name={NAME} canOperate />);
    await user.click(trigger());
    expect(
      screen.getByRole("menuitem", { name: t("forms.tab.builder") }).getAttribute("href"),
    ).toBe("/forms/frm%20a%2Fb");
  });
});
