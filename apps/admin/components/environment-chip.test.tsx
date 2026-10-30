import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EnvironmentSwitcher } from "./environment-switcher.tsx";
import { ENVIRONMENT_COOKIE, environmentKind } from "../lib/environment.ts";
import { t } from "../lib/i18n/en.ts";

/**
 * The chip the switcher is (ADR-40 Q6, `plan/admin-design-contracts.md` §10).
 *
 * The three drawing states and the announcement are what a unit test can see; that the
 * Operations header mounts it, and that switching shifts no screen, are the browser
 * suite's.
 */

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
      // An environment an operator created is non-prod without anybody listing it.
      ["staging", "nonprod"],
    ] as const) {
      const { control, unmount } = chip(environment);
      expect(control.getAttribute("data-environment")).toBe(environment);
      expect(control.getAttribute("data-kind")).toBe(kind);
      expect(control.textContent).toContain(environment);
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
