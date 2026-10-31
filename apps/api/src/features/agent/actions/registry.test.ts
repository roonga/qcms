import { describe, expect, it } from "vitest";

import { ACTION_KINDS, ACTION_KIND_NAMES, actionKind, actionKindForRoute } from "./registry.js";

/**
 * The registry's own invariants, and criterion 8's per-kind result allowlist: what the next
 * turn may learn about a confirmed step is the kind's own list, and no entry on it can name
 * a credential (SEC-8, section 7.6).
 */

/**
 * Field names that carry a credential, bytes or content. A kind that allowlisted one of
 * them would put it in the next request body, which is the one place section 7.6 says it
 * never goes. Matched as a word fragment so `webhookSecret` and `recoveryCodes` fail too.
 */
const FORBIDDEN_FRAGMENTS = [
  "answer",
  "byte",
  "code",
  "content",
  "csv",
  "key",
  "password",
  "payload",
  "secret",
  "token",
  "url",
] as const;

function offendingFragment(field: string): string | undefined {
  const lowered = field.toLowerCase();
  return FORBIDDEN_FRAGMENTS.find((fragment) => lowered.includes(fragment));
}

describe("the action-kind registry", () => {
  it("is frozen, so nothing can graft a kind on at runtime", () => {
    expect(Object.isFrozen(ACTION_KINDS)).toBe(true);
  });

  it("names every registered kind exactly once", () => {
    expect([...ACTION_KIND_NAMES].sort()).toEqual([...new Set(ACTION_KIND_NAMES)].sort());
    expect(ACTION_KIND_NAMES.map((name) => actionKind(name)?.kind)).toEqual([...ACTION_KIND_NAMES]);
  });

  it("resolves each kind from its own route and nothing else", () => {
    for (const def of Object.values(ACTION_KINDS)) {
      expect(actionKindForRoute(def.route.method, def.route.path)?.kind).toBe(def.kind);
      expect(actionKindForRoute("GET", def.route.path)).toBeUndefined();
    }
    expect(actionKindForRoute("POST", "/admin/forms/{id}/draft")).toBeUndefined();
  });
});

describe("the result allowlist, per kind (criterion 8)", () => {
  it("allowlists no field whose name carries a credential, bytes or content", () => {
    for (const def of Object.values(ACTION_KINDS)) {
      for (const field of def.resultAllowlist) {
        expect(
          offendingFragment(field),
          `${def.kind} allowlists "${field}"`,
        ).toBeUndefined();
      }
    }
  });

  it("keeps a minted link's URL off `link.mint`'s allowlist", () => {
    const mint = actionKind("link.mint");
    expect(mint?.resultAllowlist).toEqual(["count", "expiresAt", "environment"]);
    expect(mint?.resultAllowlist).not.toContain("url");
    expect(mint?.resultAllowlist).not.toContain("links");
  });

  it("makes every referenceable field allowlisted, so a plan cannot reference what the next turn may not learn", () => {
    for (const def of Object.values(ACTION_KINDS)) {
      for (const field of def.references) {
        expect(def.resultAllowlist, def.kind).toContain(field);
      }
    }
  });

  it("declares a non-empty allowlist and at least one referenceable field for every kind", () => {
    for (const def of Object.values(ACTION_KINDS)) {
      expect(def.resultAllowlist.length, def.kind).toBeGreaterThan(0);
      expect(def.references.length, def.kind).toBeGreaterThan(0);
    }
  });
});

describe("each kind's card templates (criterion 5)", () => {
  it("names catalog keys under its own `agent.card.<kind>.` namespace", () => {
    for (const def of Object.values(ACTION_KINDS)) {
      expect(def.card.titleKey, def.kind).toBe(`agent.card.${def.kind}.title`);
      expect(def.card.consequenceKeys.length, def.kind).toBeGreaterThan(0);
      for (const key of def.card.consequenceKeys) {
        expect(key.startsWith("agent.card."), `${def.kind}: ${key}`).toBe(true);
      }
    }
  });

  it("gives an argument-environment kind the argument that carries it", () => {
    for (const def of Object.values(ACTION_KINDS)) {
      if (def.environmentFrom !== "argument") {
        expect(def.environmentArgument, def.kind).toBeUndefined();
        continue;
      }
      expect(def.environmentArgument, def.kind).toBeDefined();
    }
  });
});
