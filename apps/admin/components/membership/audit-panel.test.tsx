import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { readAuditFilters } from "@/lib/membership/audit-filters";
import type { AuditPage, AuditRow } from "@/lib/membership/types";

import { AuditPanel } from "./audit-panel";

const BASE = "/workspaces/ws_1/audit";

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "aa_1",
    actor: "usr_1",
    actorEmail: "grace@qcms.test",
    environment: null,
    formId: null,
    kind: "grant",
    occurredAt: "2026-11-20T00:00:00.000Z",
    detail: "Authors",
    ...overrides,
  };
}

function page(rows: readonly AuditRow[], overrides: Partial<AuditPage> = {}): AuditPage {
  return { workspaceId: "ws_1", rows, page: 1, pageSize: 50, total: rows.length, ...overrides };
}

function renderPanel(
  audit: AuditPage | undefined,
  params: Record<string, string> = {},
  message?: string,
) {
  render(
    <AuditPanel
      audit={audit}
      message={message}
      filters={readAuditFilters(params)}
      basePath={BASE}
      locale="en-GB"
    />,
  );
}

describe("the workspace audit panel", () => {
  it("reads every stored kind in words rather than its wire value", () => {
    renderPanel(
      page([
        row({ id: "aa_1", kind: "group" }),
        row({ id: "aa_2", kind: "administrator" }),
        row({ id: "aa_3", kind: "approval" }),
        row({ id: "aa_4", kind: "link" }),
        row({ id: "aa_5", kind: "derive" }),
      ]),
    );
    for (const words of [
      "Changed an access group",
      "Changed a Workspace administrator",
      "An approval request",
      "Respondent links",
      "Derived a theme from a website",
    ]) {
      expect(screen.getByText(words), words).toBeTruthy();
    }
    expect(screen.queryByText("administrator")).toBeNull();
  });

  it("tags a mirrored site act, and tags nothing else", () => {
    renderPanel(page([row({ kind: "account" }), row({ id: "aa_2", kind: "setting" })]));
    expect(screen.getAllByText("From Site audit")).toHaveLength(1);
    expect(screen.getByText("An act on an account")).toBeTruthy();
  });

  it("narrows the page to one account and says how many rows that left", () => {
    renderPanel(page([row(), row({ id: "aa_2", actorEmail: "sam@qcms.test" })]), {
      person: "sam@qcms.test",
    });
    expect(screen.getByTestId("qcms-audit-narrowed").textContent).toBe(
      "1 of the 2 rows on this page are sam@qcms.test.",
    );
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.queryByText("grace@qcms.test")).toBeNull();
  });

  it("says so when the chosen account has no row on this page", () => {
    renderPanel(page([row()]), { person: "nobody@qcms.test" });
    expect(screen.getByTestId("qcms-audit-narrowed").textContent).toBe(
      "No row on this page is nobody@qcms.test.",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("pages the audit, keeping the filters on the next page's address", () => {
    renderPanel(page([row()], { total: 120, pageSize: 50 }), { kind: "grant" });
    const next = screen.getByRole("link", { name: "Next" });
    expect(next.getAttribute("href")).toBe(`${BASE}?kind=grant&page=2`);
    expect(screen.getByText("1 to 50 of 120")).toBeTruthy();
  });

  it("reports a refused read as a refusal, never as an empty audit", () => {
    renderPanel(undefined, {}, "403");
    expect(screen.getByText(/could not be read: 403/u)).toBeTruthy();
    expect(screen.queryByText("Nothing has been recorded in this workspace yet.")).toBeNull();
  });

  it("says nothing has been recorded over an empty page", () => {
    renderPanel(page([]));
    expect(screen.getByText("Nothing has been recorded in this workspace yet.")).toBeTruthy();
  });
});
