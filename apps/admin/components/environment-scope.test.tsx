import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnvironmentScope } from "./environment-scope.tsx";
import { FormActions } from "./forms/form-actions.tsx";
import { ResponseDetail } from "./ops/response-detail.tsx";
import { ENVIRONMENT_COOKIE } from "../lib/environment.ts";
import { IDLE_PUBLISH, IDLE_PUBLISH_RELEASE } from "../lib/forms/builder-state.ts";
import type { DraftForm } from "../lib/forms/types.ts";
import { t } from "../lib/i18n/en.ts";
import type { ResponseDetail as ResponseDetailData } from "../lib/ops/types.ts";

/**
 * What a tab does about an environment it can no longer vouch for (local UX list A1, A12).
 *
 * Three behaviours, each at the layer that owns it: the shell's scope re-reads a tab that
 * comes back into view under a cookie another tab changed; controls that act in one
 * environment are disabled while the shell could not confirm which; and when an action is
 * refused because the environment changed, the refusal is said inside the dialog the
 * operator is looking at rather than behind it. The refusal itself is the server action's
 * and is pinned in `lib/server/environment-actions.test.ts`.
 */

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const DRAFT: DraftForm = {
  formId: "form-1",
  defaultLocale: "en",
  title: { en: "Intake" },
  steps: [{ stepId: "step-1", title: { en: "About you" }, items: [] }],
  rules: [],
};

const SWITCHED = t("environment.switched", { shown: "prod", current: "test" });

function formActions(setStatus = () => Promise.resolve({ status: "error", message: SWITCHED })) {
  return (
    <FormActions
      slug="intake"
      formId="form-1"
      status="open"
      draft={DRAFT}
      latestVersion={1}
      publish={() => Promise.resolve(IDLE_PUBLISH)}
      publishAndRelease={() => Promise.resolve(IDLE_PUBLISH_RELEASE)}
      setStatus={setStatus as () => Promise<{ status: "error"; message: string }>}
      environment="prod"
    />
  );
}

function setCookie(value: string): void {
  document.cookie = `${ENVIRONMENT_COOKIE}=${value}; Path=/`;
}

function becomeVisible(): void {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  document.cookie = `${ENVIRONMENT_COOKIE}=; Path=/; Max-Age=0`;
});

describe("returning to a tab", () => {
  it("re-reads the page when another tab switched the environment", () => {
    setCookie("prod");
    render(
      <EnvironmentScope selection="prod" unknown={false}>
        {null}
      </EnvironmentScope>,
    );

    setCookie("test");
    becomeVisible();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("leaves the page alone when the selection is what it was rendered from", () => {
    setCookie("test");
    render(
      <EnvironmentScope selection="test" unknown={false}>
        {null}
      </EnvironmentScope>,
    );

    becomeVisible();

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("an unknown environment", () => {
  it("disables close and publish-and-release, and leaves publish alone", () => {
    render(
      <EnvironmentScope selection="test" unknown>
        {formActions()}
      </EnvironmentScope>,
    );

    const close = screen.getByRole("button", {
      name: t("forms.lifecycle.close", { environment: "prod" }),
    });
    const release = screen.getByRole("button", { name: t("forms.publishRelease.action") });
    const publish = screen.getByRole("button", { name: t("forms.publish.action") });

    expect(close.hasAttribute("disabled")).toBe(true);
    expect(release.hasAttribute("disabled")).toBe(true);
    // Publishing reaches no environment (ADR-40), so it does not wait on one.
    expect(publish.hasAttribute("disabled")).toBe(false);
  });

  it("leaves everything enabled outside the unknown state", () => {
    render(
      <EnvironmentScope selection="prod" unknown={false}>
        {formActions()}
      </EnvironmentScope>,
    );

    const close = screen.getByRole("button", {
      name: t("forms.lifecycle.close", { environment: "prod" }),
    });
    expect(close.hasAttribute("disabled")).toBe(false);
  });
});

describe("a refusal because another tab switched", { timeout: 30_000 }, () => {
  it("is said inside the close dialog, which stays open", async () => {
    const user = userEvent.setup();
    render(formActions());

    await user.click(
      screen.getByRole("button", { name: t("forms.lifecycle.close", { environment: "prod" }) }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", {
        name: t("forms.lifecycle.confirmClose", { environment: "prod" }),
      }),
    );

    expect(
      await within(dialog).findByText(t("forms.lifecycle.failed", { message: SWITCHED })),
    ).toBeTruthy();
  });

  it("is said inside the erase dialog", async () => {
    const detail: ResponseDetailData = {
      sessionId: "ses_01HQ",
      formId: "form-1",
      formVersion: 3,
      submittedAt: "2026-01-01T00:00:00.000Z",
      accessMode: "anonymous",
      flaggedReason: null,
      contentHash: "sha256:0000",
      answers: {},
      ledger: [],
    };
    const user = userEvent.setup();
    render(
      <ResponseDetail
        detail={detail}
        pins={[]}
        labels={new Map()}
        labelsFailed={false}
        linksHref="/forms/form-1/links"
        environment="prod"
        erase={() => Promise.resolve({ status: "error", message: SWITCHED })}
        unflag={() => Promise.resolve({ status: "error" })}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("ops.erase.button") }));
    const dialog = await screen.findByTestId("qcms-erase-dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: t("ops.erase.confirmLabel") }),
      detail.sessionId,
    );
    await user.click(within(dialog).getByRole("button", { name: t("ops.erase.confirm") }));

    expect(
      await within(dialog).findByText(t("ops.erase.failed", { message: SWITCHED })),
    ).toBeTruthy();
    expect(screen.queryByTestId("qcms-tombstone")).toBeNull();
  });
});
