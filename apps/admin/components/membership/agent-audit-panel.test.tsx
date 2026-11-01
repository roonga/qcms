import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AgentAuditPage, AgentAuditRow } from "@/lib/membership/types";

import { AgentAuditPanel } from "./agent-audit-panel";

/**
 * A refused read has to say so. An empty table would tell a workspace owner "the
 * assistant has changed nothing here", which is the one thing a refusal does not know.
 */

function row(overrides: Partial<AgentAuditRow> = {}): AgentAuditRow {
  return {
    id: "aa_1",
    proposalId: "prp_1",
    stepIndex: 1,
    stepCount: 3,
    actor: "usr_1",
    actorEmail: "owner@qcms.test",
    environment: "test",
    formId: "frm_quote",
    kind: "form.release",
    screen: "/forms/[formId]/publish",
    proposedAt: "2026-07-20T00:00:00.000Z",
    confirmedAt: "2026-07-20T00:01:00.000Z",
    detail: "version=3",
    ...overrides,
  };
}

function page(rows: readonly AgentAuditRow[]): AgentAuditPage {
  return { workspaceId: "ws_1", rows, page: 1, pageSize: 50, total: rows.length };
}

describe("the agent audit panel", () => {
  it("shows the act, which step of which plan it was, and the non-content detail", () => {
    render(<AgentAuditPanel audit={page([row()])} message={undefined} />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("form.release")).toBeTruthy();
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.getByText("/forms/[formId]/publish")).toBeTruthy();
    expect(screen.getByText("version=3")).toBeTruthy();
    expect(screen.getByText("owner@qcms.test")).toBeTruthy();
  });

  it("names the account id when the account is gone, because the row holds no key to it", () => {
    render(<AgentAuditPanel audit={page([row({ actorEmail: null })])} message={undefined} />);
    expect(screen.getByText("usr_1 (account removed)")).toBeTruthy();
  });

  it("says a refused read was refused rather than rendering an empty table", () => {
    render(<AgentAuditPanel audit={undefined} message="Forbidden" />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/could not be read: Forbidden/)).toBeTruthy();
  });

  it("distinguishes nothing recorded from nothing readable", () => {
    render(<AgentAuditPanel audit={page([])} message={undefined} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/confirmed nothing in this workspace yet/)).toBeTruthy();
  });
});
