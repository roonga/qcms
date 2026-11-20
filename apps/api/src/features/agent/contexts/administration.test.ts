import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findAccountById: vi.fn(),
  listAccountDirectory: vi.fn(),
  listApprovalRequests: vi.fn(),
  listSiteAudit: vi.fn(),
}));

vi.mock("@roonga/qcms-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roonga/qcms-db")>()),
  findAccountById: db.findAccountById,
  listAccountDirectory: db.listAccountDirectory,
  listApprovalRequests: db.listApprovalRequests,
  listSiteAudit: db.listSiteAudit,
}));

import { administrationContexts } from "./administration.js";
import type { ScreenBuildInput } from "./support.js";

const control = new Proxy(
  {},
  {
    get() {
      throw new Error("the control database was read");
    },
  },
);

function inputWith(claim: boolean, params: Record<string, string> = {}): ScreenBuildInput {
  return {
    deps: { databases: { control } } as unknown as ScreenBuildInput["deps"],
    principal: { userId: "usr_1", claim },
    environment: "prod",
    params,
    conversationId: "cnv_1",
    visitId: "vis_1",
  };
}

const row = {
  userId: "usr_2",
  email: "a@qcms.test",
  name: "A",
  role: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  claimedAt: null,
  disabledAt: null,
};

const screens = [
  ["/site/accounts", administrationContexts.siteAccounts, {}],
  ["/site/accounts/new", administrationContexts.siteAccounts, {}],
  ["/site/accounts/[accountId]", administrationContexts.siteAccountDetail, { accountId: "usr_2" }],
] as const;

describe("the Site accounts screens", () => {
  beforeEach(() => {
    db.findAccountById.mockReset();
    db.listAccountDirectory.mockReset();
    db.listAccountDirectory.mockResolvedValue({ rows: [row], total: 1 });
  });

  it.each(screens)(
    "refuses a caller without the installation claim on %s, unread",
    async (_id, context, params) => {
      db.findAccountById.mockImplementation(() => {
        throw new Error("the account was read");
      });
      db.listAccountDirectory.mockImplementation(() => {
        throw new Error("the directory was read");
      });
      await expect(context.build(inputWith(false, params))).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
      expect(db.findAccountById).not.toHaveBeenCalled();
      expect(db.listAccountDirectory).not.toHaveBeenCalled();
    },
  );

  it("names no account on the list and new screens", async () => {
    const facts = await administrationContexts.siteAccounts.build(inputWith(true));
    expect(facts).toMatchObject({ total: 1, account: null });
    expect(db.findAccountById).not.toHaveBeenCalled();
  });

  it("refuses the detail screen without an account id", async () => {
    await expect(
      administrationContexts.siteAccountDetail.build(inputWith(true)),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
  });

  it("gives the named account on the detail screen", async () => {
    db.findAccountById.mockResolvedValue(row);
    const facts = await administrationContexts.siteAccountDetail.build(
      inputWith(true, { accountId: "usr_2" }),
    );
    expect(facts.account).toMatchObject({ accountId: "usr_2", email: "a@qcms.test" });
  });

  it("answers ACCOUNT_NOT_FOUND for an account that does not exist", async () => {
    db.findAccountById.mockResolvedValue(undefined);
    await expect(
      administrationContexts.siteAccountDetail.build(inputWith(true, { accountId: "usr_x" })),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND", status: 404 });
  });
});

describe("the Site administrators, Approval requests and Site audit screens", () => {
  const request = {
    requestId: "apr_1",
    scope: "workspace",
    workspaceId: "org_1",
    kind: "second-approval-off",
    target: "org_1",
    payload: {},
    requestedBy: "usr_2",
    requestedAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-01-08T00:00:00.000Z"),
    status: "pending",
    decidedBy: null,
    decidedAt: null,
  };
  const auditRow = {
    id: "1",
    actor: "system",
    subject: "apr_1",
    workspaceId: null,
    kind: "approval",
    occurredAt: new Date("2026-01-08T00:00:00.000Z"),
    detail: "act=expire kind=promote target=usr_3 requester=usr_2",
  };

  beforeEach(() => {
    db.listApprovalRequests.mockReset();
    db.listSiteAudit.mockReset();
    db.listApprovalRequests.mockResolvedValue({ rows: [request], total: 1 });
    db.listSiteAudit.mockResolvedValue({ rows: [auditRow], total: 1 });
  });

  it.each([
    ["/site/approval-requests", administrationContexts.siteApprovalRequests],
    ["/site/audit", administrationContexts.siteAudit],
  ] as const)(
    "refuses a caller without the installation claim on %s, unread",
    async (_id, context) => {
      await expect(context.build(inputWith(false))).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
      expect(db.listApprovalRequests).not.toHaveBeenCalled();
      expect(db.listSiteAudit).not.toHaveBeenCalled();
    },
  );

  it("lists requests without the held publishes, which are decided on their forms", async () => {
    const facts = await administrationContexts.siteApprovalRequests.build(inputWith(true));
    expect(db.listApprovalRequests).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ excludeKinds: ["draft-publish"] }),
    );
    expect(facts).toMatchObject({
      total: 1,
      requests: [
        { requestId: "apr_1", scope: "workspace", requestedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    expect(administrationContexts.siteApprovalRequests.facts.safeParse(facts).success).toBe(true);
  });

  it("gives the site audit's rows, the system's own among them", async () => {
    const facts = await administrationContexts.siteAudit.build(inputWith(true));
    expect(facts).toMatchObject({ total: 1, rows: [{ actor: "system", kind: "approval" }] });
    expect(administrationContexts.siteAudit.facts.safeParse(facts).success).toBe(true);
  });
});
