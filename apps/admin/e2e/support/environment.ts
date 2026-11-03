import type { Page } from "@playwright/test";

import { expect } from "../../../portal/e2e/support/gates.js";
import { ADMIN_BASE_URL } from "./harness-config.js";
import { ENVIRONMENT_COOKIE } from "../../lib/environment.js";
import { openMenu } from "./flow.js";

export const TEST_ENVIRONMENT_STORAGE = {
  cookies: [
    {
      name: ENVIRONMENT_COOKIE,
      value: "test",
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    },
  ],
  origins: [],
};

export const OPERATIONS_PATH = "/operations";

export function environmentChip(page: Page) {
  return page.getByTestId("qcms-environment-switcher");
}

export async function chooseEnvironment(page: Page, environment: "test" | "prod"): Promise<void> {
  const from = page.url();
  const away = new URL(from).pathname !== OPERATIONS_PATH;
  if (away) await page.goto(OPERATIONS_PATH);
  const chip = environmentChip(page);
  if ((await chip.getAttribute("data-environment")) !== environment) {
    await openMenu(chip.getByRole("button"));
    await page.getByRole("menuitemradio", { name: environment, exact: true }).click();
    await expect(chip).toHaveAttribute("data-pending", "false");
    await expect(chip).toHaveAttribute("data-environment", environment);
  }
  if (away) await page.goto(from);
}

// Use for tests that need the cookie to disagree with a control without navigating away from that control.
export async function presetEnvironment(page: Page, environment: "test" | "prod"): Promise<void> {
  await page
    .context()
    .addCookies([{ name: ENVIRONMENT_COOKIE, value: environment, url: ADMIN_BASE_URL }]);
}

// Layout sweeps prepare the preference; behavior journeys must exercise the real switcher.
export async function setScreenEnvironment(page: Page, path: string): Promise<void> {
  const authoring = /^\/forms\/(?:new$|frm_[^/?#]+(?:\/(?:rules|preview))?(?:[?#]|$))/u.test(path);
  await page
    .context()
    .addCookies([
      { name: ENVIRONMENT_COOKIE, value: authoring ? "test" : "prod", url: ADMIN_BASE_URL },
    ]);
}
