import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EnvironmentSwitcher } from "./environment-switcher.tsx";
import { ENVIRONMENT_COOKIE, environmentKind } from "../lib/environment.ts";
import { t } from "../lib/i18n/en.ts";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const SET = ["prod", "test", "staging"];

function chip(selected: string) {
  const view = render(
    <EnvironmentSwitcher environments={SET} selected={selected} secureCookies={false} />,
  );
  return { control: screen.getByTestId("qcms-environment-switcher"), unmount: view.unmount };
}

describe("the environment chip", () => {
  it("writes the name and the drawing kind for every state", () => {
    for (const [environment, kind] of [
      ["prod", "prod"],
      ["test", "nonprod"],
      ["staging", "nonprod"],
    ] as const) {
      const { control, unmount } = chip(environment);
      expect(control.getAttribute("data-environment")).toBe(environment);
      expect(control.getAttribute("data-kind")).toBe(kind);
      expect(control.textContent).toContain(environment);
      expect(control.querySelector(".qcms-envchip")?.getAttribute("data-kind")).toBe(kind);
      expect(
        screen.getByRole("button", { name: t("environment.trigger", { environment }) }),
      ).toBeTruthy();
      unmount();
    }
  });

  it("calls an unread set unknown rather than production", () => {
    expect(environmentKind(undefined)).toBe("unknown");
    expect(environmentKind("")).toBe("unknown");
  });

  it("announces after a switch and says nothing on first render", async () => {
    const user = userEvent.setup();
    const { control } = chip("prod");
    const status = screen.getByTestId("qcms-environment-status");
    expect(status.textContent).toBe("");

    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("menuitemradio", { name: "test" }));

    expect(status.textContent).toBe(t("environment.nowWorking", { environment: "test" }));
    expect(control.getAttribute("data-kind")).toBe("nonprod");
    expect(document.cookie).toContain(`${ENVIRONMENT_COOKIE}=test`);
    expect(refresh).toHaveBeenCalled();
  });
});

describe("the environment dropdown", () => {
  it("labels the slot and offers the change on the trigger", () => {
    const { control } = chip("prod");
    expect(control.textContent).toContain(t("environment.legend"));
    expect(control.textContent).toContain(t("environment.change"));
    const trigger = screen.getByRole("button");
    expect(trigger.getAttribute("aria-haspopup")).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("offers one radio row per environment, naming it, meaning it and marking the current one", async () => {
    const user = userEvent.setup();
    chip("prod");
    await user.click(screen.getByRole("button"));

    const rows = screen.getAllByRole("menuitemradio");
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);

    const production = screen.getByRole("menuitemradio", { name: "prod" });
    const describes = production.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describes)?.textContent).toBe(t("environment.meaning.prod"));
    expect(production.textContent).toContain(t("environment.selected"));

    const other = screen.getByRole("menuitemradio", { name: "staging" });
    const meaning = other.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(meaning)?.textContent).toBe(t("environment.meaning.nonProd"));
    expect(other.textContent).not.toContain(t("environment.selected"));
  });

  it("says what a choice reaches, outside the rows the arrow keys walk", async () => {
    const user = userEvent.setup();
    chip("prod");
    await user.click(screen.getByRole("button"));

    const note = screen.getByText(t("environment.appliesTo"));
    expect(screen.getByRole("menu").contains(note)).toBe(false);
  });
});
