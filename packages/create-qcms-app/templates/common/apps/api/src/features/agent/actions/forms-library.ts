import { z } from "zod";

import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/**
 * D7's one act: creating a form from the library. The screen's own control redirects into
 * the builder, so the card calls the non-redirecting variant and shows a link instead.
 */

const CreateFormArgs = z.strictObject({
  slug: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "The slug the form is addressed by. The form id is derived from it once and never " +
        "changes, so a mistyped slug is permanent.",
    ),
  defaultLocale: z
    .string()
    .min(2)
    .max(35)
    .describe("The locale the first draft is authored in, such as en or en-AU."),
  workspaceId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "The workspace the form belongs to. Omitted where the installation has one, and " +
        "required where it has more.",
    ),
});

function bodyMember(facts: ActionRequestFacts, name: string): unknown {
  return typeof facts.body === "object" && facts.body !== null
    ? (facts.body as Record<string, unknown>)[name]
    : undefined;
}

export const createForm: ActionKindDef = {
  kind: "form.create",
  screen: "/forms",
  route: { method: "POST", path: "/admin/forms" },
  cell: { resource: "form", action: "write" },
  environmentFrom: "switcher",
  args: CreateFormArgs,
  // The request also carries `formId`, which the admin derives from the slug with the
  // same function the screen uses. It is left out of the digest because the model never
  // names it: binding the slug binds everything a proposal can choose.
  recomputeArgs: (facts) => ({
    slug: bodyMember(facts, "slug"),
    defaultLocale: bodyMember(facts, "defaultLocale"),
    ...(bodyMember(facts, "workspaceId") === undefined
      ? {}
      : { workspaceId: bodyMember(facts, "workspaceId") }),
  }),
  references: ["formId"],
  resultAllowlist: ["formId", "slug"],
  card: {
    titleKey: "agent.card.form.create.title",
    consequenceKeys: ["agent.card.form.create.consequence"],
    headingControl: "forms.create",
    createdLink: { screen: "/forms/[formId]", field: "formId" },
  },
  description:
    "Create a form and its empty first draft in a workspace this user may create in. The " +
    "id is minted from the slug and never changes. The form's title is authored in the " +
    "builder afterwards; creating it changes nothing a respondent can reach.",
};
