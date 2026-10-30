import { describe, expect, it } from "vitest";

import { InMemoryRateLimitStore } from "../../../rate-limit.js";
import { auditedRead, type ScreenBuildInput } from "./support.js";

function inputWith(store: InMemoryRateLimitStore, conversationId = "cnv_1"): ScreenBuildInput {
  return {
    deps: { rateLimitStore: store } as unknown as ScreenBuildInput["deps"],
    principal: { userId: "usr_1", claim: false },
    environment: "prod",
    params: {},
    conversationId,
  };
}

describe("auditedRead", () => {
  const store = (): InMemoryRateLimitStore =>
    new InMemoryRateLimitStore({ now: () => new Date("2026-10-31T00:00:00.000Z") });

  it("asks the first turn of a conversation for the row and no later one", async () => {
    const input = inputWith(store());
    const asked: boolean[] = [];
    for (let turn = 0; turn < 3; turn += 1) {
      await auditedRead(input, "list:frm_a:[]", (audit) => {
        asked.push(audit);
        return Promise.resolve(undefined);
      });
    }
    expect(asked).toEqual([true, false, false]);
  });

  it("asks again when the write that owed the row failed", async () => {
    const input = inputWith(store());
    await expect(
      auditedRead(input, "list:frm_a:[]", () => Promise.reject(new Error("transaction rolled back"))),
    ).rejects.toThrow("transaction rolled back");

    let asked: boolean | undefined;
    await auditedRead(input, "list:frm_a:[]", (audit) => {
      asked = audit;
      return Promise.resolve(undefined);
    });
    expect(asked).toBe(true);
  });

  it("keys each distinct subject and conversation on its own row", async () => {
    const shared = store();
    const asked: boolean[] = [];
    const record = (audit: boolean): Promise<undefined> => {
      asked.push(audit);
      return Promise.resolve(undefined);
    };
    await auditedRead(inputWith(shared), "list:frm_a:[]", record);
    await auditedRead(inputWith(shared), "list:frm_a:[1,null,null,null]", record);
    await auditedRead(inputWith(shared, "cnv_2"), "list:frm_a:[]", record);
    expect(asked).toEqual([true, true, true]);
  });
});
