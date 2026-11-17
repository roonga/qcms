import { z } from "zod";

import { CreateFormBody } from "../../forms/schema.js";
import { ACTION_DESCRIPTIONS } from "../prompts/prompts.generated.js";
import { routeArgs, stated, type StepArgs } from "./derive.js";
import type { ActionKindDef } from "./types.js";

/**
 * D7's one act: creating a form from the library. The screen's own control redirects into
 * the builder, so the card calls the non-redirecting variant and shows a link instead.
 */

const create = routeArgs(
  CreateFormBody,
  {
    slug: CreateFormBody.shape.slug
      .max(200)
      .describe(
        "The slug the form is addressed by. The form id is derived from it once and never " +
          "changes, so a mistyped slug is permanent.",
      ),
    // Narrower than the route's own bound: a locale tag is at least a language subtag.
    defaultLocale: z
      .string()
      .min(2)
      .max(35)
      .describe("The locale the first draft is authored in, such as en or en-AU."),
    workspaceId: stated(CreateFormBody.shape.workspaceId)
      .max(200)
      .optional()
      .describe(
        "The workspace the form belongs to. Omitted where the installation has one, and " +
          "required where it has more.",
      ),
  } satisfies StepArgs<typeof CreateFormBody.shape, "formId" | "title", never>,
  // `formId` the admin derives from the slug with the function the screen uses, and the
  // model never names it, so binding the slug binds everything a proposal can choose. The
  // first draft carries the title, and a create card offers the slug and the locale alone.
  { unnamed: ["formId", "title"] },
);

export const createForm: ActionKindDef = {
  kind: "form.create",
  screen: "/forms",
  route: { method: "POST", path: "/admin/forms" },
  cell: { resource: "form", action: "write" },
  environmentFrom: "switcher",
  ...create,
  // The slug is permanent, so the card always names where the form lands: the screen's
  // workspace when the model names none.
  screenDefaults: (args, screen) =>
    args["workspaceId"] === undefined && screen.workspaceId !== undefined
      ? { ...args, workspaceId: screen.workspaceId }
      : args,
  references: ["formId"],
  resultAllowlist: ["formId", "slug"],
  card: {
    titleKey: "agent.card.form.create.title",
    consequenceKeys: ["agent.card.form.create.consequence"],
    headingControl: "forms.create",
    createdLink: { screen: "/forms/[formId]", field: "formId" },
  },
  description: ACTION_DESCRIPTIONS["form.create"],
};
