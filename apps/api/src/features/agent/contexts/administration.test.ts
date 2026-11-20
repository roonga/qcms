import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findAccountById: vi.fn(),
  listAccountDirectory: vi.fn(),
}));

vi.mock("@roonga/qcms-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roonga/qcms-db")>()),
  findAccountById: db.findAccountById,
  listAccountDirectory: db.listAccountDirectory,
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
