import { describe, expect, it } from "vitest";

import {
  argumentsDigest,
  canonicalJson,
  isStepReference,
  PROPOSAL_MAX_STEPS,
  PROPOSAL_TTL_MS,
  signProposalToken,
  verifyProposalToken,
  type ProposalStepBinding,
} from "./proposal-token.js";

const APP_KEY = "test-app-key-0123456789abcdefghijklmn";

const issuedAt = new Date("2026-10-31T09:00:00.000Z");

async function step(
  kind: string,
  args: unknown,
  environment: string,
): Promise<ProposalStepBinding> {
  return { kind, argsDigest: await argumentsDigest(args), environment };
}

describe("canonicalJson", () => {
  it("sorts keys at every depth so member order cannot change a digest", () => {
    const left = canonicalJson({ b: 1, a: { d: [1, 2], c: "x" } });
    const right = canonicalJson({ a: { c: "x", d: [1, 2] }, b: 1 });
    expect(left).toBe(right);
    expect(left).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
  });

  it("keeps array order, which is step and option order", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it("drops undefined members rather than writing them", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("refuses a non-finite number, which JSON would write as null", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});

describe("argumentsDigest", () => {
  it("is stable across member order and differs on any value change", async () => {
    const one = await argumentsDigest({ environment: "test", version: 3 });
    const same = await argumentsDigest({ version: 3, environment: "test" });
    const other = await argumentsDigest({ version: 4, environment: "test" });
    expect(one).toBe(same);
    expect(one).not.toBe(other);
  });

  it("keeps a reference symbolic, so the digest binds the reference and not a value", async () => {
    const symbolic = await argumentsDigest({ version: { fromStep: 0, field: "version" } });
    const resolved = await argumentsDigest({ version: 3 });
    expect(symbolic).not.toBe(resolved);
  });
});

describe("isStepReference", () => {
  it("accepts exactly the two-member symbolic shape", () => {
    expect(isStepReference({ fromStep: 0, field: "version" })).toBe(true);
    expect(isStepReference({ fromStep: -1, field: "version" })).toBe(false);
    expect(isStepReference({ fromStep: 0, field: "version", extra: 1 })).toBe(false);
    expect(isStepReference({ fromStep: 0 })).toBe(false);
    expect(isStepReference(null)).toBe(false);
  });
});

describe("signProposalToken and verifyProposalToken", () => {
  it("round-trips the ordered step list, the subject and the ten-minute lifetime", async () => {
    const steps = [
      await step("form.publish", { formId: "frm_a" }, "test"),
      await step("form.release", { formId: "frm_a", version: 3, environment: "prod" }, "prod"),
    ];
    const token = await signProposalToken(APP_KEY, {
      sub: "user_1",
      pid: "prp_1",
      steps,
      formId: "frm_a",
      issuedAt,
    });

    const result = await verifyProposalToken(APP_KEY, token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.sub).toBe("user_1");
    expect(result.payload.pid).toBe("prp_1");
    expect(result.payload.formId).toBe("frm_a");
    expect(result.payload.iat).toBe(issuedAt.getTime());
    expect(result.payload.exp).toBe(issuedAt.getTime() + PROPOSAL_TTL_MS);
    expect(result.payload.steps.map((row) => row.kind)).toEqual(["form.publish", "form.release"]);
    expect(result.payload.steps.map((row) => row.environment)).toEqual(["test", "prod"]);
  });

  it("refuses a tampered body", async () => {
    const token = await signProposalToken(APP_KEY, {
      sub: "user_1",
      pid: "prp_1",
      steps: [await step("form.publish", { formId: "frm_a" }, "test")],
      issuedAt,
    });
    const [body, mac] = token.split(".");
    const forged = await signProposalToken(APP_KEY, {
      sub: "user_1",
      pid: "prp_1",
      steps: [await step("form.publish", { formId: "frm_b" }, "test")],
      issuedAt,
    });
    expect(body).toBeDefined();
    const swapped = `${forged.split(".")[0] ?? ""}.${mac ?? ""}`;
    const result = await verifyProposalToken(APP_KEY, swapped);
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_SIGNATURE" });
  });

  it("refuses a token signed under another app key", async () => {
    const token = await signProposalToken(APP_KEY, {
      sub: "user_1",
      pid: "prp_1",
      steps: [await step("form.publish", { formId: "frm_a" }, "test")],
      issuedAt,
    });
    const result = await verifyProposalToken(`${APP_KEY}-rotated`, token);
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_SIGNATURE" });
  });

  it("refuses a malformed token", async () => {
    expect(await verifyProposalToken(APP_KEY, "not-a-token")).toEqual({
      ok: false,
      code: "AGENT_PROPOSAL_MALFORMED",
    });
    expect(await verifyProposalToken(APP_KEY, ".")).toEqual({
      ok: false,
      code: "AGENT_PROPOSAL_MALFORMED",
    });
  });

  it("refuses an empty or over-long step list at signing time", async () => {
    const one = await step("form.publish", { formId: "frm_a" }, "test");
    await expect(
      signProposalToken(APP_KEY, { sub: "user_1", pid: "prp_1", steps: [], issuedAt }),
    ).rejects.toThrow();
    await expect(
      signProposalToken(APP_KEY, {
        sub: "user_1",
        pid: "prp_1",
        steps: Array.from({ length: PROPOSAL_MAX_STEPS + 1 }, () => one),
        issuedAt,
      }),
    ).rejects.toThrow();
  });

  it("derives a key that differs from the raw app key, so the purpose is separated", async () => {
    const token = await signProposalToken(APP_KEY, {
      sub: "user_1",
      pid: "prp_1",
      steps: [await step("form.publish", { formId: "frm_a" }, "test")],
      issuedAt,
    });
    const mac = token.split(".")[1] ?? "";
    const raw = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(APP_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const direct = await crypto.subtle.sign(
      "HMAC",
      raw,
      new TextEncoder().encode(token.split(".")[0] ?? ""),
    );
    const hex = [...new Uint8Array(direct)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(mac).not.toBe(hex);
    expect(mac.length).toBeGreaterThan(0);
  });
});
