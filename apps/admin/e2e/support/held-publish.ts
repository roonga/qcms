import type { Browser } from "@playwright/test";

import { holdDraftPublishForTest } from "../../../api/e2e/support/held-publish.js";
import { readFixtures } from "../../../portal/e2e/support/fixtures.js";

import { accountIdOf, createTestAdmin, uniqueAdminEmail } from "./admin-account.js";
import { createForm } from "./forms.js";
import { enrollNewAdmin } from "./flow.js";

export interface HeldPublishFixture {
  readonly formId: string;
  readonly requester: { readonly email: string; readonly secret: string };
  readonly approver: { readonly email: string; readonly secret: string };
}

export const HELD_LANDING = /\/(questions|forms|me\/access)/u;

/** A form whose draft publish to prod waits for an Approver, with its requester and one approver. */
export async function prepareHeldPublish(
  browser: Browser,
  label: string,
): Promise<HeldPublishFixture> {
  const requesterEmail = uniqueAdminEmail(`${label}requester`);
  const approverEmail = uniqueAdminEmail(`${label}approver`);
  await createTestAdmin(requesterEmail, { name: "Grace Mensah" });
  await createTestAdmin(approverEmail, {
    name: "Luis Ortega",
    grants: ["forms.viewer", "forms.publisher"],
    owner: false,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const requesterSecret = await enrollNewAdmin(page, requesterEmail, HELD_LANDING);
    const formId = await createForm(page, `${label}-${Date.now().toString(36)}`, "Patient intake");
    await holdDraftPublishForTest(readFixtures().databaseUrl, {
      formId,
      workspaceId: "org_default_workspace",
      requestedBy: await accountIdOf(requesterEmail),
    });
    await context.clearCookies();
    const approverSecret = await enrollNewAdmin(page, approverEmail, HELD_LANDING);
    return {
      formId,
      requester: { email: requesterEmail, secret: requesterSecret },
      approver: { email: approverEmail, secret: approverSecret },
    };
  } finally {
    await context.close();
  }
}
