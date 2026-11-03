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
