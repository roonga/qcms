import { z } from "zod";

import { WorkspaceThemeBody } from "../../workspaces/schema.js";
import { ACTION_DESCRIPTIONS } from "../prompts/prompts.generated.js";
import { routeArgs, type StepArgs } from "./derive.js";
import type { ActionKindDef } from "./types.js";

/**
 * The builder's two theme acts. A derive reaches a website, so no proposal names the address:
 * the card collects it, shows it in full and hands it to the drawer, and the fetch is the
 * SEC-18 fetcher's (W2). A save is an ordinary tokened Confirm over the drawer's live look.
 */

const WorkspaceIdArg = z
  .string()
  .min(1)
  .max(200)
  .describe("The workspace whose themes this acts on.");

const save = routeArgs(
  WorkspaceThemeBody,
  {
    workspaceId: WorkspaceIdArg,
    name: WorkspaceThemeBody.shape.name.describe(
      "What to call the theme. A workspace cannot hold two themes of the same name.",
    ),
  } satisfies StepArgs<
    typeof WorkspaceThemeBody.shape,
    "palettes" | "face" | "corners" | "pageTint" | "logoKey" | "sourceHost",
    "workspaceId"
  >,
  // The look is the one the drawer is showing when the person confirms, so none of it is a
  // value a model chose and none of it is bound as an argument.
  {
    unnamed: ["palettes", "face", "corners", "pageTint", "logoKey", "sourceHost"],
    params: { workspaceId: "id" },
  },
);

/**
 * Reads one website and answers colours, a registry face and a stored logo, saving no theme.
 * The address is the user's: they type it on the card, which is where it is shown in full,
 * and nothing is fetched before Confirm.
 */
export const deriveWorkspaceTheme: ActionKindDef = {
  kind: "theme.derive",
  screen: "/forms/[formId]/build",
  cell: { resource: "form", action: "write" },
  environmentFrom: "switcher",
  // No `url` member, so a proposal that names an address is refused on its arguments alone.
  args: z.strictObject({ workspaceId: WorkspaceIdArg }),
  recomputeArgs: () => ({}),
  references: [],
  // The colours reach the next turn as the builder's own derived-theme fact, under that
  // fact's strict schema. The step reports which workspace it read for and nothing else.
  resultAllowlist: ["workspaceId"],
  handOff: true,
  card: {
    titleKey: "agent.card.theme.derive.title",
    consequenceKeys: [
      "agent.card.theme.derive.consequence",
      "agent.card.theme.derive.stored",
      "agent.card.theme.derive.handOff",
    ],
    headingControl: "appearance.derive",
    typedInput: "url",
  },
  description: ACTION_DESCRIPTIONS["theme.derive"],
};

/**
 * The look in the drawer, kept as a workspace theme every form in the workspace can pick.
 * A hand-off, because the look being kept is the drawer's live state and nowhere else: the
 * Confirm opens that control with the name on it, and the drawer's own save is what runs.
 */
export const saveWorkspaceTheme: ActionKindDef = {
  kind: "theme.save",
  screen: "/forms/[formId]/build",
  route: { method: "POST", path: "/admin/workspaces/{id}/themes" },
  cell: { resource: "form", action: "write" },
  environmentFrom: "switcher",
  ...save,
  references: [],
  resultAllowlist: ["themeId", "name"],
  handOff: true,
  card: {
    titleKey: "agent.card.theme.save.title",
    consequenceKeys: ["agent.card.theme.save.consequence", "agent.card.theme.save.reuse"],
    headingControl: "appearance.themeSave",
  },
  description: ACTION_DESCRIPTIONS["theme.save"],
};
