import { describe, expect, it } from "vitest";

import {
  EDIT_TOKEN_PURPOSE,
  EDIT_TOKEN_VERSION,
  EDIT_TTL_MS,
  EDITS_PER_TURN,
  mintTurnEditTokens,
  signEditToken,
  verifyEditToken,
} from "./edit-token.js";
import { PROPOSAL_TOKEN_PURPOSE, signProposalToken } from "./proposal-token.js";

const KEY = "edit-token-test-key-edit-token-test";
const AT = new Date("2026-07-20T00:00:00.000Z");

async function minted(ops: Parameters<typeof mintTurnEditTokens>[1]["ops"], startRevision = 4) {
  return mintTurnEditTokens(KEY, {
    sub: "usr_a",
    formId: "frm_a",
    startRevision,
    ops,
    issuedAt: AT,
  });
}

describe("the agent edit token", () => {
  it("binds each op of a turn to the next revision in order", async () => {
    const { turnId, tokens } = await minted(["question", "rule", "appearance"]);
    expect(turnId).toMatch(/^edt_[a-z0-9]+$/u);
    const payloads = await Promise.all(tokens.map((token) => verifyEditToken(KEY, token, AT)));
    expect(
      payloads.map((result) =>
        result.ok && result.payload.act === "edit"
          ? [result.payload.n, result.payload.op, result.payload.rev, result.payload.tid]
          : undefined,
      ),
    ).toEqual([
      [0, "question", 4, turnId],
      [1, "rule", 5, turnId],
      [2, "appearance", 6, turnId],
    ]);
  });

  it("mints no more than the per-turn cap", async () => {
    await expect(
      minted(Array.from({ length: EDITS_PER_TURN + 1 }, () => "copy" as const)),
    ).rejects.toThrow();
    expect(
      (await minted(Array.from({ length: EDITS_PER_TURN }, () => "copy" as const))).tokens,
    ).toHaveLength(EDITS_PER_TURN);
  });

  it("refuses a tampered body, another key and a truncated token", async () => {
    const [token] = (await minted(["copy"])).tokens as [string];
    const [body, mac] = token.split(".") as [string, string];
    const flipped = `${body.slice(0, -1)}${body.endsWith("A") ? "B" : "A"}.${mac}`;
    expect(await verifyEditToken(KEY, flipped, AT)).toMatchObject({ ok: false });
    expect(await verifyEditToken("another-key-another-key-another-k", token, AT)).toEqual({
      ok: false,
      code: "AGENT_EDIT_SIGNATURE",
    });
    expect(await verifyEditToken(KEY, body, AT)).toEqual({
      ok: false,
      code: "AGENT_EDIT_MALFORMED",
    });
  });

  it("expires ten minutes after issue", async () => {
    const [token] = (await minted(["copy"])).tokens as [string];
    const edge = new Date(AT.getTime() + EDIT_TTL_MS);
    expect((await verifyEditToken(KEY, token, edge)).ok).toBe(true);
    expect(await verifyEditToken(KEY, token, new Date(edge.getTime() + 1))).toEqual({
      ok: false,
      code: "AGENT_EDIT_EXPIRED",
    });
  });

  it("does not accept a proposal token, which is signed under another purpose key", async () => {
    const proposal = await signProposalToken(KEY, {
      sub: "usr_a",
      pid: "prp_a",
      steps: [{ kind: "form.saveDraft", argsDigest: "x", environment: "test" }],
      issuedAt: AT,
    });
    expect(PROPOSAL_TOKEN_PURPOSE).not.toBe(EDIT_TOKEN_PURPOSE);
    expect(await verifyEditToken(KEY, proposal, AT)).toEqual({
      ok: false,
      code: "AGENT_EDIT_SIGNATURE",
    });
  });

  it("refuses to sign an op outside the draft-scoped set", async () => {
    const iat = AT.getTime();
    await expect(
      signEditToken(KEY, {
        v: EDIT_TOKEN_VERSION,
        purpose: EDIT_TOKEN_PURPOSE,
        act: "edit",
        sub: "usr_a",
        formId: "frm_a",
        tid: "edt_abcdefgh",
        n: 0,
        op: "publish" as "copy",
        rev: 1,
        iat,
        exp: iat + EDIT_TTL_MS,
      }),
    ).rejects.toThrow();
  });
});
