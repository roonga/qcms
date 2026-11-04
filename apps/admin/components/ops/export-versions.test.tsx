import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "../../lib/i18n/en.ts";
import { parseResponseQuery } from "../../lib/ops/response-filters.ts";

/**
 * The export dialog's version control says only what was read: a `responses.viewer` is
 * refused the form's published list and gets the versions its own responses carry.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

const { ResponseBrowser } = await import("./response-browser.tsx");

const PAGE = {
  ok: true as const,
  data: {
    responses: [
      {
        sessionId: "ses_one",
        formVersion: 2,
        submittedAt: "2026-08-01T10:00:00.000Z",
        accessMode: "anonymous" as const,
        flaggedReason: null,
        answers: {},
      },
    ],
    formVersions: [2, 1],
    page: 1,
    pageSize: 50,
    total: 1,
  },
};

async function openDialog(versions: readonly number[] | undefined) {
  const user = userEvent.setup();
  const parsed = parseResponseQuery({});
  render(
    <ResponseBrowser
      formId="frm_one"
      versions={versions}
      filters={parsed.applied}
      hasFilters={parsed.hasFilters}
      page={PAGE}
    />,
  );
  await user.click(screen.getByRole("button", { name: t("ops.export.open") }));
  return { user, dialog: screen.getByTestId("qcms-export-dialog") };
}

/** The download when it is offered, or `undefined` while it is the disabled button. */
function downloadHref(): string | null | undefined {
  return screen.queryByTestId("qcms-export-download")?.getAttribute("href");
}

function disabledDownload(): HTMLElement | null {
  return screen.queryByRole("button", { name: t("ops.export.download") });
}

describe("the export dialog's version list", { timeout: 30_000 }, () => {
  it("offers the versions a response viewer's own responses carry", async () => {
    const { user, dialog } = await openDialog([2, 1]);

    expect(dialog.querySelector('[data-testid="qcms-export-no-versions"]')).toBeNull();
    expect(dialog.querySelector('[data-testid="qcms-export-unknown-versions"]')).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: /Version$/u }));
    expect(screen.getByRole("option", { name: "v2" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "v1" })).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "v2" }));

    expect(downloadHref()).toContain("version=2");
  });

  it("says there is no version only when the list was read and is empty", async () => {
    const { dialog } = await openDialog([]);

    expect(dialog.querySelector('[data-testid="qcms-export-no-versions"]')).not.toBeNull();
    expect(dialog.querySelector('[data-testid="qcms-export-unknown-versions"]')).toBeNull();
    expect(downloadHref()).toBeUndefined();
    expect(disabledDownload()?.hasAttribute("disabled")).toBe(true);
  });

  it("says the versions are unknown, and not absent, when the list was not read", async () => {
    const { user, dialog } = await openDialog(undefined);

    expect(dialog.querySelector('[data-testid="qcms-export-unknown-versions"]')).not.toBeNull();
    expect(dialog.querySelector('[data-testid="qcms-export-no-versions"]')).toBeNull();
    // CSV names a version, so it stays unavailable; JSON carries each response's own, so
    // an unread version list costs the operator the CSV export and nothing else.
    expect(downloadHref()).toBeUndefined();
    expect(disabledDownload()?.hasAttribute("disabled")).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: /Format$/u }));
    await user.click(screen.getByRole("option", { name: t("ops.export.json") }));

    expect(downloadHref()).toContain("format=json");
  });
});
