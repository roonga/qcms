import { describe, expect, it } from "vitest";

import { t } from "../i18n/en.ts";

import type { Account } from "./accounts.ts";
import {
  demoteControl,
  promoteCandidates,
  promoteControl,
  readPromoteSearch,
} from "./administrators.ts";
import {
  approvalRequestsHref,
  approvalRequestsQuery,
  decisionControl,
  readApprovalFilters,
  requestSentence,
  type SiteApprovalRequest,
} from "./approvals.ts";
import {
  detailFields,
  readSiteAuditFilters,
  siteAuditActLabel,
  siteAuditActor,
  siteAuditHref,
  siteAuditPeople,
  siteAuditSubject,
  type SiteAuditRow,
} from "./audit.ts";
import { slugCandidates, starterEnvironments, workspaceSlugFrom } from "./workspaces.ts";

const account = (overrides: Partial<Account>): Account => ({
  userId: "usr_a",
  email: "a@example.test",
  name: "Aiko Tanaka",
  siteAdministrator: false,
  status: "active",
  ...overrides,
});

describe("promote and demote controls", () => {
  const viewer = (count: number) => ({ userId: "usr_me", activeSiteAdministrators: count });

  it("promotes on step-up alone while the viewer is the only Site administrator", () => {
    expect(promoteControl(account({}), viewer(1))).toEqual({ approval: "stepUpAlone" });
    expect(promoteControl(account({}), viewer(2))).toEqual({ approval: "needsApprover" });
  });

  it("refuses to promote an unclaimed or a disabled account, with the reason", () => {
    expect(promoteControl(account({ status: "unclaimed" }), viewer(1)).blocked).toBe("unclaimed");
    expect(promoteControl(account({ status: "disabled" }), viewer(3)).blocked).toBe("disabled");
  });

  it("demotes the other of exactly two on step-up alone, and waits at three", () => {
    const other = account({ siteAdministrator: true });
    expect(demoteControl(other, viewer(2))).toEqual({ approval: "stepUpAlone" });
    expect(demoteControl(other, viewer(3))).toEqual({ approval: "needsApprover" });
  });

  it("never demotes the last active Site administrator", () => {
    const me = account({ userId: "usr_me", siteAdministrator: true });
    expect(demoteControl(me, viewer(1)).blocked).toBe("lastSiteAdministrator");
    expect(demoteControl(me, viewer(2))).toEqual({ approval: "needsApprover" });
  });

  it("offers only accounts that are not Site administrators yet, and reads a bounded search", () => {
    const candidates = promoteCandidates([
      account({ userId: "usr_1", siteAdministrator: true }),
      account({ userId: "usr_2" }),
    ]);
    expect(candidates.map((entry) => entry.userId)).toEqual(["usr_2"]);
    expect(readPromoteSearch({ q: `  ${"x".repeat(300)}` }).search).toHaveLength(200);
  });
});

const request = (overrides: Partial<SiteApprovalRequest>): SiteApprovalRequest => ({
  requestId: "apr_1",
  scope: "site",
  workspaceId: null,
  kind: "promote",
  target: "usr_target",
  payload: {},
  requestedBy: "usr_asker",
  requestedAt: "2026-11-10T09:00:00.000Z",
  expiresAt: "2026-11-17T09:00:00.000Z",
  status: "pending",
  decidedBy: null,
  decidedAt: null,
  ...overrides,
});

describe("approval request decisions", () => {
  it("never offers the requester an Approve, whatever the scope", () => {
    expect(decisionControl(request({}), "usr_asker")).toEqual({
      kind: "blocked",
      reason: "ownRequest",
    });
    expect(
      decisionControl(request({ scope: "workspace", workspaceId: "org_1" }), "usr_asker"),
    ).toEqual({ kind: "blocked", reason: "ownRequest" });
  });

  it("never lets the target decide a site request about them", () => {
    expect(decisionControl(request({}), "usr_target")).toEqual({
      kind: "blocked",
      reason: "target",
    });
  });

  it("asks a step-up to approve a site request, and none for a workspace one", () => {
    expect(decisionControl(request({}), "usr_other")).toEqual({
      kind: "decide",
      stepUp: true,
    });
    expect(
      decisionControl(request({ scope: "workspace", workspaceId: "org_1" }), "usr_other"),
    ).toEqual({ kind: "decide", stepUp: false });
  });

  it("offers nothing once the request was decided or the sweep expired it", () => {
    expect(decisionControl(request({ status: "expired" }), "usr_other")).toEqual({
      kind: "decided",
    });
    expect(decisionControl(request({ status: "rejected" }), "usr_other")).toEqual({
      kind: "decided",
    });
  });

  it("names who asked, about whom and where", () => {
    const names = {
      person: (id: string) => ({ usr_asker: "Sam Okafor", usr_target: "Priya Shah" })[id] ?? id,
      workspace: (id: string | null) => (id === "org_1" ? "Clinical" : ""),
    };
    expect(requestSentence(request({}), names)).toBe(
      "Sam Okafor asked to make Priya Shah a Site administrator.",
    );
    expect(
      requestSentence(
        request({ scope: "workspace", workspaceId: "org_1", kind: "second-approval-off" }),
        names,
      ),
    ).toBe("Sam Okafor asked to turn Second approval off in Clinical.");
  });

  it("lists pending requests unless asked otherwise, and keeps the filters across pages", () => {
    const fresh = readApprovalFilters({});
    expect(fresh).toMatchObject({ status: "pending", scope: undefined, activeCount: 0 });
    expect(approvalRequestsQuery(fresh)).toBe("?status=pending");
    const all = readApprovalFilters({ status: "all", scope: "workspace", page: "2" });
    expect(all).toMatchObject({ status: undefined, scope: "workspace", page: 2, activeCount: 2 });
    expect(approvalRequestsQuery(all)).toBe("?scope=workspace&page=2");
    expect(approvalRequestsHref(all, 3)).toBe(
      "/site/approval-requests?scope=workspace&status=all&page=3",
    );
    expect(readApprovalFilters({ status: "bogus" }).status).toBe("pending");
  });
});

const row = (overrides: Partial<SiteAuditRow>): SiteAuditRow => ({
  id: "1",
  actor: "usr_sam",
  actorEmail: "sam@example.test",
  subject: "usr_aiko",
  workspaceId: null,
  kind: "account",
  occurredAt: "2026-11-12T09:00:00.000Z",
  detail: "act=create",
  ...overrides,
});

describe("site audit rows", () => {
  it("names the system as itself, never as an account or a removed one", () => {
    const expired = row({ actor: "system", actorEmail: null, kind: "approval" });
    expect(siteAuditActor(expired)).toBe(t("site.audit.system"));
    expect(siteAuditActor(expired)).not.toContain("removed");
    expect(siteAuditActor(row({ actorEmail: null }))).toBe("usr_sam (account removed)");
  });

  it("reads the act from the detail", () => {
    expect(detailFields("act=reset reset=factor suspended=2").get("reset")).toBe("factor");
    expect(siteAuditActLabel(row({}))).toBe("Account created");
    expect(siteAuditActLabel(row({ detail: "act=reset reset=password suspended=0" }))).toBe(
      "Password reset",
    );
    expect(
      siteAuditActLabel(
        row({ kind: "approval", detail: "act=expire kind=demote target=usr_x requester=usr_y" }),
      ),
    ).toBe("Request expired: demote a Site administrator");
    expect(
      siteAuditActLabel(
        row({ kind: "administrator", detail: "act=promote approval=step-up-only" }),
      ),
    ).toBe("Promoted to Site administrator");
    expect(siteAuditActLabel(row({ kind: "unheard-of", detail: null }))).toBe("unheard-of");
  });

  it("resolves what a row is about: the account, a request's target, or a workspace", () => {
    const names = {
      people: new Map([
        ["usr_aiko", "Aiko Tanaka"],
        ["usr_x", "Priya Shah"],
      ]),
      workspaces: new Map([["org_1", "Clinical"]]),
    };
    expect(siteAuditSubject(row({}), names)).toBe("Aiko Tanaka");
    const approval = row({
      kind: "approval",
      subject: "apr_1",
      detail: "act=request kind=promote target=usr_x",
    });
    expect(siteAuditSubject(approval, names)).toBe("Priya Shah");
    expect(siteAuditSubject(row({ kind: "library", subject: "org_1" }), names)).toBe("Clinical");
    expect(siteAuditPeople([row({}), approval])).toEqual(["usr_aiko", "usr_x"]);
  });

  it("filters by kind and pages", () => {
    const filters = readSiteAuditFilters({ kind: "approval", page: "2" });
    expect(filters).toEqual({ kind: "approval", page: 2, activeCount: 1 });
    expect(siteAuditHref(filters, 3)).toBe("/site/audit?kind=approval&page=3");
    expect(readSiteAuditFilters({ kind: "nope" }).kind).toBeUndefined();
  });
});

describe("a new workspace's identifier and starter groups", () => {
  it("makes a stored identifier from the name", () => {
    expect(workspaceSlugFrom("Clinical Trials (EU)")).toBe("clinical-trials-eu");
    expect(workspaceSlugFrom("Équipe Née")).toBe("equipe-nee");
    expect(workspaceSlugFrom("日本")).toBe("workspace");
    expect(workspaceSlugFrom("a".repeat(80))).toHaveLength(48);
  });

  it("tries numbered identifiers after the name's own, each within the limit", () => {
    const candidates = slugCandidates("x".repeat(60));
    expect(candidates).toHaveLength(5);
    expect(candidates[1]).toMatch(/-2$/u);
    for (const slug of candidates) expect(slug.length).toBeLessThanOrEqual(48);
  });

  it("says when a starter group has no environment set", () => {
    expect(
      starterEnvironments({ name: "Authors", roles: ["forms.editor"], environments: [] }, "en-GB"),
    ).toBe("No environment set");
    expect(
      starterEnvironments(
        { name: "Publishers", roles: ["forms.publisher"], environments: ["prod"] },
        "en-GB",
      ),
    ).toBe("prod");
  });
});
