import { describe, expect, it } from "vitest";

import { appGroups } from "../../registrars.js";
import { ALLOWED_AUTH_ENDPOINTS, registerAdminAuthProxy } from "../auth/route.js";
import { passwordUseFor, registerAccountClaim } from "./claim-route.js";
import { CLAIM_PATH } from "./tokens.js";

describe("where the claim is mounted", () => {
  const auth = appGroups.auth ?? [];

  it("sits before the better-auth proxy, which answers 404 to every path it does not allowlist", () => {
    const claim = auth.indexOf(registerAccountClaim);
    const proxy = auth.indexOf(registerAdminAuthProxy);
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(proxy).toBeGreaterThanOrEqual(0);
    expect(claim).toBeLessThan(proxy);
  });

  it("is not a better-auth endpoint, so the allowlist neither admits nor needs it", () => {
    expect(ALLOWED_AUTH_ENDPOINTS).not.toContain(`POST ${CLAIM_PATH}`);
  });

  it("is outside the admin group, because it issues the session that group's gate reads", () => {
    expect(appGroups.admin ?? []).not.toContain(registerAccountClaim);
  });
});

describe("what a link's purpose does with the password", () => {
  const fresh = { holdsPassword: false, wasReset: false };

  it("never sets a password over one a reset kept, whatever the link", () => {
    expect(passwordUseFor("reset", { holdsPassword: true, wasReset: true })).toBe("verify");
    expect(passwordUseFor("account-created", { holdsPassword: true, wasReset: true })).toBe(
      undefined,
    );
  });

  it("sets one through a creation, a reactivation or a password reset link", () => {
    expect(passwordUseFor("account-created", fresh)).toBe("set");
    expect(passwordUseFor("reactivated", { holdsPassword: false, wasReset: true })).toBe("set");
    expect(passwordUseFor("reset", { holdsPassword: false, wasReset: true })).toBe("set");
  });

  it("refuses a purpose it does not know", () => {
    expect(passwordUseFor("bootstrap", fresh)).toBe(undefined);
    expect(passwordUseFor("", { holdsPassword: true, wasReset: true })).toBe(undefined);
  });
});
