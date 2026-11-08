import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AgentAuditNames } from "@/lib/membership/audit-wording";
import type { AgentAuditPage, AgentAuditRow } from "@/lib/membership/types";

import { AgentAuditPanel } from "./agent-audit-panel";

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
    detail: "3",
    ...overrides,
  };
}

function page(rows: readonly AgentAuditRow[]): AgentAuditPage {
  return { workspaceId: "ws_1", rows, page: 1, pageSize: 50, total: rows.length };
}

const NAMES: AgentAuditNames = {
  groups: new Map([["tm_1", "Response viewer, test, 1 form"]]),
  people: new Map([["usr_2", "held@qcms.test"]]),
};

const EMPTY: AgentAuditNames = { groups: new Map(), people: new Map() };

describe("the agent audit panel", () => {
  it("reads the act, its detail and the screen in words rather than wire values", () => {
    render(<AgentAuditPanel audit={page([row()])} message={undefined} names={EMPTY} />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("Released a form version")).toBeTruthy();
    expect(screen.getByText("Version: 3")).toBeTruthy();
    expect(screen.getByText("Publish")).toBeTruthy();
    expect(screen.queryByText("form.release")).toBeNull();
    expect(screen.queryByText("/forms/[formId]/publish")).toBeNull();
  });

  it("drops the step column and groups the steps under the plan they belong to", () => {
    render(
      <AgentAuditPanel
        audit={page([
          row({ id: "aa_2", stepIndex: 1, kind: "access.grant", detail: "tm_1" }),
          row({ id: "aa_3", stepIndex: 0, kind: "access.groupCreate", detail: "tm_1" }),
        ])}
        message={undefined}
        names={NAMES}
      />,
    );
    expect(screen.queryByRole("columnheader", { name: "Step" })).toBeNull();
    const plans = screen.getAllByTestId("qcms-agent-audit-plan");
    expect(plans).toHaveLength(1);
    expect(plans[0]?.textContent).toBe("Plan of 3 steps, confirmed by owner@qcms.test");

    const acts = screen
      .getAllByRole("row")
      .map((entry) => entry.textContent ?? "")
      .filter((text) => text.includes("access group"));
    expect(acts[0]).toContain("Created an access group");
    expect(acts[1]).toContain("Granted an access group");
  });

  it("names the group a step acted on", () => {
    render(
      <AgentAuditPanel
        audit={page([row({ kind: "access.grant", detail: "tm_1" })])}
        message={undefined}
        names={NAMES}
      />,
    );
    expect(screen.getByText("Access group: Response viewer, test, 1 form")).toBeTruthy();
  });

  it("marks a person taken down since as removed rather than dropping the act", () => {
    render(
      <AgentAuditPanel
        audit={page([row({ kind: "access.revoke", detail: "usr_gone" })])}
        message={undefined}
        names={NAMES}
      />,
    );
    expect(screen.getByText("Person: usr_gone (removed)")).toBeTruthy();
  });

  it("says every row is a step that was confirmed and then succeeded", () => {
    render(<AgentAuditPanel audit={page([row()])} message={undefined} names={EMPTY} />);
    expect(screen.getByText(/confirmed by a person and then succeeded/)).toBeTruthy();
    expect(screen.getByText(/refused, cancelled or failed records nothing/)).toBeTruthy();
  });

  it("names the account id when the account is gone, because the row holds no key to it", () => {
    render(
      <AgentAuditPanel
        audit={page([row({ actorEmail: null })])}
        message={undefined}
        names={EMPTY}
      />,
    );
    expect(screen.getAllByText(/usr_1 \(account removed\)/).length).toBeGreaterThan(0);
  });

  it("says a refused read was refused rather than rendering an empty table", () => {
    render(<AgentAuditPanel audit={undefined} message="Forbidden" names={EMPTY} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/could not be read: Forbidden/)).toBeTruthy();
  });

  it("distinguishes nothing recorded from nothing readable", () => {
    render(<AgentAuditPanel audit={page([])} message={undefined} names={EMPTY} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/confirmed nothing in this workspace yet/)).toBeTruthy();
  });
});
