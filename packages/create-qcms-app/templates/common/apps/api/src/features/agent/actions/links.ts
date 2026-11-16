import { z } from "zod";

import { MintLinksBody } from "../../links/schema.js";
import { ACTION_DESCRIPTIONS } from "../prompts/prompts.generated.js";
import { routeArgs, stated, type StepArgs } from "./derive.js";
import type { ActionKindDef } from "./types.js";

/** D3's two kinds. A minted URL is a bearer credential and reaches the user only. */

const FormIdArg = z.string().min(1).max(200);

const mint = routeArgs(
  MintLinksBody,
  {
    formId: FormIdArg,
    count: stated(MintLinksBody.shape.count).describe("How many links to mint."),
    // A full UTC instant, not a calendar day: the mint dialog widens a date-only value to
    // the end of that day, and the digest is taken over what the request body carries.
    expiresAt: z.iso
      .datetime()
      .describe(
        "When the links stop working, as a full UTC instant such as 2026-12-31T23:59:59.000Z.",
      ),
    oneTime: stated(MintLinksBody.shape.oneTime).describe(
      "Whether each link is consumed by the first respondent.",
    ),
  } satisfies StepArgs<typeof MintLinksBody.shape, "environment", "formId">,
  // The environment is the switcher's, which a step binds rather than names.
  { unnamed: ["environment"], params: { formId: "id" } },
);

const RevokeArgs = z.strictObject({
  formId: FormIdArg,
  linkId: z.string().min(1).max(200),
});

export const mintLinks: ActionKindDef = {
  kind: "link.mint",
  screen: "/operations/forms/[formId]/links",
  route: { method: "POST", path: "/admin/forms/{id}/links" },
  cell: { resource: "link", action: "mint" },
  environmentFrom: "switcher",
  ...mint,
  references: ["count"],
  // Never `url` or `links`: a link URL carries a bearer token.
  resultAllowlist: ["count", "expiresAt", "environment"],
  card: {
    titleKey: "agent.card.link.mint.title",
    consequenceKeys: ["agent.card.link.mint.consequence"],
    headingControl: "links.mint",
  },
  description: ACTION_DESCRIPTIONS["link.mint"],
};

export const revokeLink: ActionKindDef = {
  kind: "link.revoke",
  screen: "/operations/forms/[formId]/links",
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
  description: ACTION_DESCRIPTIONS["link.revoke"],
};
