import { describe, expect, it } from "vitest";

import { readNoContent, readResult } from "./api-result.ts";

describe("readNoContent", () => {
  it("reports a 204 as a success without reading a body", async () => {
    const result = await readNoContent(new Response(null, { status: 204 }));
    expect(result).toEqual({ ok: true, data: null });
  });

  it("normalises a refusal exactly as a body-bearing read does", async () => {
    const refusal = () =>
      new Response(
        JSON.stringify({ error: { code: "GROUP_NOT_FOUND", message: "No such group" } }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      );
    expect(await readNoContent(refusal())).toEqual(await readResult(refusal()));
  });
});

/* A 202 is the API storing an act as a request an Approver has to approve. It is a success
   with nothing applied, so a caller that reads it as "done" reports a change nobody made. */
describe("a held 202", () => {
  it("reports a body-bearing 202 as held", async () => {
    const result = await readResult(
      new Response(JSON.stringify({ workspaceId: "wsp_a", requireSecondApprover: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(result).toEqual({
      ok: true,
      held: true,
      data: { workspaceId: "wsp_a", requireSecondApprover: true },
    });
  });

  it("marks no ordinary success as held", async () => {
    const result = await readResult(
      new Response(JSON.stringify({ workspaceId: "wsp_a" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(result).toEqual({ ok: true, data: { workspaceId: "wsp_a" } });
  });
});
