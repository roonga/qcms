import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "../../lib/i18n/en.ts";
import type { KnownTargetLookup } from "../../lib/ops/known-target.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

import { KnownTargetErasure } from "./known-target-erasure.tsx";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const SESSION = "ses_01J0000000000000000000000A";

function found(alreadyErased = false): KnownTargetLookup {
  return {
    status: "found",
    scope: {
      sessionId: SESSION,
      environment: "prod",
      alreadyErased,
      otherEnvironments: [{ environment: "test", alreadyErased: false }],
    },
  };
}

const ERASED = {
  status: "erased" as const,
  data: {
    sessionId: SESSION,
    formId: "frm_a",
    formVersion: 1,
    erasedAt: "2026-11-05T00:00:00.000Z",
    reason: "subject_request",
    alreadyErased: false,
  },
};

function screenWith(
  lookup: (sessionId: string) => Promise<KnownTargetLookup>,
  erase: () => Promise<typeof ERASED | { status: "error"; message: string }> = () =>
    Promise.resolve(ERASED),
) {
  return render(
    <KnownTargetErasure environment="prod" lookup={lookup} erase={erase} secureCookies={false} />,
  );
}

async function findSession(user: ReturnType<typeof userEvent.setup>, id = SESSION): Promise<void> {
  await user.type(screen.getByRole("textbox", { name: t("ops.erase.known.sessionLabel") }), id);
  await user.click(screen.getByRole("button", { name: t("ops.erase.known.find") }));
}

describe("the known-target erasure", () => {
  it("lists nothing and offers no erasure until a session id is looked up", () => {
    screenWith(() => Promise.resolve(found()));
    expect(screen.queryByRole("button", { name: t("ops.erase.button") })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("asks for an id rather than looking up nothing", async () => {
    const user = userEvent.setup();
    const lookup = vi.fn(() => Promise.resolve(found()));
    screenWith(lookup);
    await user.click(screen.getByRole("button", { name: t("ops.erase.known.find") }));
    expect(await screen.findByText(t("ops.erase.known.required"))).toBeTruthy();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("says a missing session is missing, and offers no act", async () => {
    const user = userEvent.setup();
    screenWith(() => Promise.resolve({ status: "missing" }));
    await findSession(user, "ses_nope");
    expect(
      await screen.findByText(
        t("ops.erase.known.missing", { sessionId: "ses_nope", environment: "prod" }),
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("ops.erase.button") })).toBeNull();
  });

  it("erases a found session through the type-to-confirm dialog and shows its tombstone", async () => {
    const user = userEvent.setup();
    const lookup = vi.fn(() => Promise.resolve(found()));
    const erase = vi.fn(() => Promise.resolve(ERASED));
    screenWith(lookup, erase);
    await findSession(user, `  ${SESSION}  `);
    expect(lookup).toHaveBeenCalledWith(SESSION);

    await user.click(await screen.findByRole("button", { name: t("ops.erase.button") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByTestId("qcms-erase-environment").textContent).toContain("prod");
    const confirm = within(dialog).getByRole("button", { name: t("ops.erase.confirm") });
    expect(confirm.hasAttribute("disabled") || confirm.getAttribute("aria-disabled")).toBeTruthy();
    await user.type(
      within(dialog).getByRole("textbox", { name: t("ops.erase.confirmLabel") }),
      SESSION,
    );
    await user.click(confirm);

    expect(erase).toHaveBeenCalledWith(SESSION, "subject_request");
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(await screen.findByText(t("ops.erase.done", { sessionId: SESSION }))).toBeTruthy();
    expect(screen.getByTestId("qcms-erasure-elsewhere")).toBeTruthy();
  });

  it("offers no act for a session already erased, but still the other environments", async () => {
    const user = userEvent.setup();
    screenWith(() => Promise.resolve(found(true)));
    await findSession(user);
    expect(await screen.findByText(t("ops.erase.alreadyErased"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("ops.erase.button") })).toBeNull();
    expect(screen.getByTestId("qcms-erasure-elsewhere")).toBeTruthy();
  });

  it("says a rejected lookup failed", async () => {
    const user = userEvent.setup();
    screenWith(() => Promise.reject(new TypeError("fetch failed")));
    await findSession(user);
    expect(
      await screen.findByText(t("ops.erase.known.lookupFailed", { message: unexpected() })),
    ).toBeTruthy();
  });

  it("keeps the dialog open to say a rejected erasure erased nothing", async () => {
    const user = userEvent.setup();
    screenWith(
      () => Promise.resolve(found()),
      () => Promise.reject(new TypeError("fetch failed")),
    );
    await findSession(user);
    await user.click(await screen.findByRole("button", { name: t("ops.erase.button") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: t("ops.erase.confirmLabel") }),
      SESSION,
    );
    await user.click(within(dialog).getByRole("button", { name: t("ops.erase.confirm") }));

    expect(
      await within(dialog).findByText(t("ops.erase.failed", { message: unexpected() })),
    ).toBeTruthy();
    expect(dialog.isConnected).toBe(true);
  });
});
