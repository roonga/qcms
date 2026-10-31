import type { Page } from "@playwright/test";

import { expect } from "../../../portal/e2e/support/gates.js";
import { ADMIN_BASE_URL } from "./harness-config.js";
import { ENVIRONMENT_COOKIE } from "../../lib/environment.js";
import { openMenu } from "./flow.js";

/** A remembered authoring preference, scoped to specs that exercise the shared draft. */
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

/** The one screen the chip is on: Normal mode carries no environment context. */
export const OPERATIONS_PATH = "/operations";

export function environmentChip(page: Page) {
  return page.getByTestId("qcms-environment-switcher");
}

/**
 * Switch through the real chip, which lives in the Operations header and nowhere else.
 *
 * The selection is a cookie every screen is read from, so the trip is out to Operations and
 * back to wherever the caller was. Callers `goto` their screen immediately before this, so
 * the return navigation costs a re-read rather than any state.
 */
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

/**
 * Write the preference without the chip, for a spec proving that some act does not read it.
 *
 * Deliberately not `chooseEnvironment`, which navigates out to Operations and back: a spec
 * asserting that a control carries its own environment needs the preference to disagree
 * with it while the screen under test stays where it is.
 */
export async function presetEnvironment(page: Page, environment: "test" | "prod"): Promise<void> {
  await page
    .context()
    .addCookies([{ name: ENVIRONMENT_COOKIE, value: environment, url: ADMIN_BASE_URL }]);
}

/** Layout sweeps prepare a preference; behavior journeys exercise the actual switcher. */
export async function setScreenEnvironment(page: Page, path: string): Promise<void> {
  const authoring = /^\/forms\/(?:new$|frm_[^/?#]+(?:\/(?:rules|preview))?(?:[?#]|$))/u.test(path);
  await page
    .context()
    .addCookies([
      { name: ENVIRONMENT_COOKIE, value: authoring ? "test" : "prod", url: ADMIN_BASE_URL },
    ]);
}
