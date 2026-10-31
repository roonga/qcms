import { z } from "zod";

import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/** D3's two kinds. A minted URL is a bearer credential and reaches the user only. */

const MintArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  count: z.number().int().min(1).max(100).describe("How many links to mint."),
  expiresAt: z.string().min(1).max(40).describe("When the links stop working, as an instant."),
  oneTime: z.boolean().describe("Whether each link is consumed by the first respondent."),
});

const RevokeArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  linkId: z.string().min(1).max(200),
});

function bodyMember(facts: ActionRequestFacts, name: string): unknown {
  return typeof facts.body === "object" && facts.body !== null
    ? (facts.body as Record<string, unknown>)[name]
    : undefined;
}

export const mintLinks: ActionKindDef = {
  kind: "link.mint",
  screen: "/forms/[formId]/links",
  route: { method: "POST", path: "/admin/forms/{id}/links" },
  cell: { resource: "link", action: "mint" },
  environmentFrom: "switcher",
  args: MintArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    count: bodyMember(facts, "count") ?? 1,
    expiresAt: bodyMember(facts, "expiresAt"),
    oneTime: bodyMember(facts, "oneTime") ?? false,
  }),
  references: ["count"],
  // Never `url` or `links`: a link URL carries a bearer token (SEC-8).
  resultAllowlist: ["count", "expiresAt", "environment"],
  card: {
    titleKey: "agent.card.link.mint.title",
    consequenceKeys: ["agent.card.link.mint.consequence"],
    headingControl: "links.mint",
  },
  description:
    "Mint one-time or reusable respondent links in the current environment. The URLs are " +
    "shown to the user once and are never returned to you.",
};

export const revokeLink: ActionKindDef = {
  kind: "link.revoke",
  screen: "/forms/[formId]/links",
  route: { method: "POST", path: "/admin/forms/{id}/links/{linkId}/revoke" },
  cell: { resource: "link", action: "revoke" },
  environmentFrom: "switcher",
  args: RevokeArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    linkId: facts.params.linkId ?? "",
  }),
  references: ["linkId"],
  resultAllowlist: ["linkId", "environment"],
  card: {
    titleKey: "agent.card.link.revoke.title",
    consequenceKeys: ["agent.card.link.revoke.consequence"],
  },
  description: "Revoke one respondent link in the current environment.",
};
