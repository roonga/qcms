import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ ids: [] as string[], inFlight: 0, peak: 0 }));

vi.mock("./accounts.ts", () => ({
  readAccount: async (_session: unknown, id: string) => {
    reads.ids.push(id);
    reads.inFlight += 1;
    reads.peak = Math.max(reads.peak, reads.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    reads.inFlight -= 1;
    if (id === "usr_gone") return { ok: false, code: "http_404", message: "", issues: [] };
    return {
      ok: true,
      data: { name: id === "usr_blank" ? "" : `Name ${id}`, email: `${id}@example.test` },
    };
  },
}));

import { SYSTEM_ACTOR } from "../site/audit.ts";

import { accountNames, NAME_READ_CONCURRENCY } from "./site-names.ts";
import type { AdminSession } from "./session.ts";

const session: AdminSession = {
  userId: "usr_me",
  email: "me@example.test",
  name: "Me",
  role: "admin",
  twoFactorEnabled: true,
  mustChangePassword: false,
  token: "session-token-for-this-test-only",
};

beforeEach(() => {
  reads.ids = [];
  reads.inFlight = 0;
  reads.peak = 0;
});

describe("account names for a screen", () => {
  it("reads each distinct id once, with a bounded number in flight", async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `usr_${String(index % 60)}`);
    const names = await accountNames(session, [...ids, "", SYSTEM_ACTOR]);
    expect(reads.ids).toHaveLength(60);
    expect(new Set(reads.ids).size).toBe(60);
    expect(reads.peak).toBe(NAME_READ_CONCURRENCY);
    expect(names.size).toBe(60);
  });

  it("names a nameless account by address and leaves out an id the directory lacks", async () => {
    const names = await accountNames(session, ["usr_blank", "usr_gone"]);
    expect([...names]).toEqual([["usr_blank", "usr_blank@example.test"]]);
  });
});
