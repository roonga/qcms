import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONVERSATION_STORAGE_KEY } from "@/lib/agent/conversation-state";

import SignInPage from "./page";

vi.mock("@/lib/server/session", () => ({
  currentAdminSession: () => Promise.resolve(undefined),
  SHELL_HOME_PATH: "/",
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  window.sessionStorage.clear();
});

describe("sign-in credential prefill", () => {
  it.each([undefined, "false", "true"])("gates passwords with the dev flag %s", async (flag) => {
    vi.stubEnv("QCMS_DEV_LOGIN_PREFILL", flag);
    render(
      await SignInPage({
        searchParams: Promise.resolve({ email: "dev@qcms.test", password: "dev-test-password" }),
      }),
    );

    expect(screen.getByLabelText<HTMLInputElement>(/email/i).value).toBe("dev@qcms.test");
    expect(screen.getByLabelText<HTMLInputElement>(/password/i).value).toBe(
      flag === "true" ? "dev-test-password" : "",
    );
  });
});

describe("the assistant conversation a session left in this tab", () => {
  it("is dropped by the sign-in screen, which every ended session arrives at", async () => {
    window.sessionStorage.setItem(
      CONVERSATION_STORAGE_KEY,
      JSON.stringify({ user: "u_previous", turns: [{ role: "user", content: "a private draft" }] }),
    );

    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(window.sessionStorage.getItem(CONVERSATION_STORAGE_KEY)).toBeNull();
  });
});
