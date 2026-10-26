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

export async function chooseEnvironment(page: Page, environment: "test" | "prod"): Promise<void> {
  const switcher = page.getByTestId("qcms-environment-switcher");
  if ((await switcher.getAttribute("data-environment")) === environment) return;
  await openMenu(switcher.getByRole("button"));
  await page.getByRole("menuitemradio", { name: environment, exact: true }).click();
  await expect(switcher).toHaveAttribute("data-pending", "false");
  await expect(switcher).toHaveAttribute("data-environment", environment);
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
