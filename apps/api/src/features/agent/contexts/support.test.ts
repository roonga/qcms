import { describe, expect, it } from "vitest";

import { InMemoryRateLimitStore } from "../../../rate-limit.js";
import { auditedRead, type ScreenBuildInput } from "./support.js";

function inputWith(
  store: InMemoryRateLimitStore,
  conversationId = "cnv_1",
  environment = "prod",
): ScreenBuildInput {
  return {
    deps: { rateLimitStore: store } as unknown as ScreenBuildInput["deps"],
    principal: { userId: "usr_1", claim: false },
    environment,
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
      auditedRead(input, "list:frm_a:[]", () =>
        Promise.reject(new Error("transaction rolled back")),
      ),
    ).rejects.toThrow("transaction rolled back");

    let asked: boolean | undefined;
    await auditedRead(input, "list:frm_a:[]", (audit) => {
      asked = audit;
      return Promise.resolve(undefined);
    });
    expect(asked).toBe(true);
  });

  it("asks a concurrent turn for the row when the claiming turn fails", async () => {
    const input = inputWith(store());
    const asked: boolean[] = [];
    let fail: ((error: Error) => void) | undefined;
    const blocked = new Promise<undefined>((_resolve, reject) => {
      fail = reject;
    });

    const first = auditedRead(input, "list:frm_a:[]", (audit) => {
      asked.push(audit);
      return blocked;
    });
    const second = auditedRead(input, "list:frm_a:[]", (audit) => {
      asked.push(audit);
      return Promise.resolve(undefined);
    });
    fail?.(new Error("transaction rolled back"));

    await expect(first).rejects.toThrow("transaction rolled back");
    await second;
    expect(asked).toEqual([true, true]);
  });

  it("lets a concurrent turn skip the row once the claiming turn has written it", async () => {
    const input = inputWith(store());
    const asked: boolean[] = [];
    let commit: ((value: undefined) => void) | undefined;
    const blocked = new Promise<undefined>((resolve) => {
      commit = resolve;
    });

    const first = auditedRead(input, "list:frm_a:[]", (audit) => {
      asked.push(audit);
      return blocked;
    });
    const second = auditedRead(input, "list:frm_a:[]", (audit) => {
      asked.push(audit);
      return Promise.resolve(undefined);
    });
    commit?.(undefined);

    await first;
    await second;
    expect(asked).toEqual([true, false]);
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

  it("asks for a row in each environment the one conversation reads the subject in", async () => {
    const shared = store();
    const asked: boolean[] = [];
    const record = (audit: boolean): Promise<undefined> => {
      asked.push(audit);
      return Promise.resolve(undefined);
    };
    await auditedRead(inputWith(shared, "cnv_1", "test"), "list:frm_a:[]", record);
    await auditedRead(inputWith(shared, "cnv_1", "prod"), "list:frm_a:[]", record);
    await auditedRead(inputWith(shared, "cnv_1", "prod"), "list:frm_a:[]", record);
    expect(asked).toEqual([true, true, false]);
  });
});
