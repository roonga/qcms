import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "../../lib/i18n/en.ts";
import { draftDayZone, type AppliedFilters } from "../../lib/ops/browse.ts";
import { parseResponseQuery } from "../../lib/ops/response-filters.ts";

/**
 * The response toolbar names the zone its days are ACTUALLY read in, and Apply and Export
 * keep that zone for a range nobody changed (review of PR #1077).
 *
 * The two defects this pins: a legacy address with no \`tz\` was widened in UTC by the
 * server while the hint said the operator's zone; and a range shared from Los Angeles was
 * silently re-read on the operator's Sydney clock the moment they pressed Apply, changing
 * the result set behind controls that had not changed.
 *
 * The router is stubbed to capture the address Apply pushes, which is then fed back
 * through the server's own parser: the round trip is the assertion.
 */
const pushed: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      pushed.push(href);
    },
  }),
}));

const { ResponseBrowser } = await import("./response-browser.tsx");

const OPERATOR_ZONE = "Australia/Sydney";
const originalZone = process.env.TZ;

afterEach(() => {
  pushed.length = 0;
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

const EMPTY_PAGE = { ok: true as const, data: { responses: [], page: 1, pageSize: 50, total: 0 } };

function renderToolbar(query: Record<string, string>) {
  process.env.TZ = OPERATOR_ZONE;
  const parsed = parseResponseQuery(query);
  render(
    <ResponseBrowser
      formId="frm_one"
      versions={[3]}
      filters={parsed.applied}
      hasFilters={parsed.hasFilters}
      page={EMPTY_PAGE}
    />,
  );
  return parsed;
}

function hints(): string[] {
  return screen
    .getAllByText(/^Whole days, in /u)
    .map((node) => node.textContent ?? "")
    .filter((text, index, all) => all.indexOf(text) === index);
}

/** Press Apply and return what the server would parse out of the pushed address. */
async function applyAndReparse() {
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: t("ops.responses.filter.apply") }));
  expect(pushed).toHaveLength(1);
  const query = Object.fromEntries(new URL(pushed[0]!, "http://admin.test").searchParams);
  return { query, parsed: parseResponseQuery(query) };
}

describe("the response toolbar's day zone", { timeout: 30_000 }, () => {
  it("names the operator's zone for a new range, when nothing is applied", () => {
    renderToolbar({});
    expect(hints()).toEqual([`Whole days, in ${OPERATOR_ZONE}.`]);
  });

  it("names UTC for a legacy address with no zone, which is what the server applied", async () => {
    const before = renderToolbar({ from: "2026-07-01", to: "2026-07-31" });
    expect(before.request.from).toBe("2026-07-01T00:00:00.000Z");
    expect(hints()).toEqual(["Whole days, in UTC."]);
    // Apply without touching the days keeps them on UTC rather than moving them to Sydney.
    const { query, parsed } = await applyAndReparse();
    expect(query["tz"]).toBe("UTC");
    expect(parsed.request).toEqual(before.request);
  });

  it("names UTC for an unknown zone, which the server also reads as UTC", () => {
    const before = renderToolbar({ from: "2026-07-01", tz: "Not/AZone" });
    expect(before.request.from).toBe("2026-07-01T00:00:00.000Z");
    expect(hints()).toEqual(["Whole days, in UTC."]);
  });

  it("keeps a shared foreign zone on Apply, so the result set does not move", async () => {
    const before = renderToolbar({
      version: "3",
      from: "2026-07-01",
      to: "2026-07-01",
      tz: "America/Los_Angeles",
    });
    expect(before.request.from).toBe("2026-07-01T07:00:00.000Z");
    expect(hints()).toEqual(["Whole days, in America/Los_Angeles."]);
    const { query, parsed } = await applyAndReparse();
    expect(query["tz"]).toBe("America/Los_Angeles");
    expect(parsed.request).toEqual(before.request);
  });

  it("exports the same shared range in the same zone", async () => {
    renderToolbar({
      version: "3",
      from: "2026-07-01",
      to: "2026-07-01",
      tz: "America/Los_Angeles",
    });
    await userEvent.setup().click(screen.getByRole("button", { name: t("ops.export.open") }));
    const link = await screen.findByTestId("qcms-export-download");
    const exported = new URL(link.getAttribute("href") ?? "", "http://admin.test").searchParams;
    expect(exported.get("tz")).toBe("America/Los_Angeles");
    expect(exported.get("from")).toBe("2026-07-01T07:00:00.000Z");
    expect(exported.get("to")).toBe("2026-07-02T06:59:59.999Z");
  });
});

describe("draftDayZone", () => {
  const applied = (extra: Partial<AppliedFilters>): AppliedFilters => ({
    version: "",
    from: "",
    to: "",
    flagged: "",
    ...extra,
  });

  it("reads a new range on the operator's clock", () => {
    expect(draftDayZone(applied({}), { from: "2026-07-01", to: "" }, OPERATOR_ZONE)).toBe(
      OPERATOR_ZONE,
    );
    expect(draftDayZone(applied({}), { from: "", to: "" }, null)).toBeNull();
  });

  it("keeps an untouched applied range in its zone, UTC when it named none", () => {
    const shared = applied({ from: "2026-07-01", tz: "America/Los_Angeles" });
    expect(draftDayZone(shared, { from: "2026-07-01", to: "" }, OPERATOR_ZONE)).toBe(
      "America/Los_Angeles",
    );
    const legacy = applied({ from: "2026-07-01" });
    expect(draftDayZone(legacy, { from: "2026-07-01", to: "" }, OPERATOR_ZONE)).toBe("UTC");
  });

  it("moves a range the operator changed onto their own clock", () => {
    const shared = applied({ from: "2026-07-01", tz: "America/Los_Angeles" });
    expect(draftDayZone(shared, { from: "2026-07-02", to: "" }, OPERATOR_ZONE)).toBe(OPERATOR_ZONE);
    expect(draftDayZone(shared, { from: "2026-07-01", to: "2026-07-05" }, OPERATOR_ZONE)).toBe(
      OPERATOR_ZONE,
    );
  });
});
