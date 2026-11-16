import { z } from "zod";

import { EraseBody, ExportQuery } from "../../responses/admin/schema.js";
import { ACTION_DESCRIPTIONS } from "../prompts/prompts.generated.js";
import { routeArgs, stated, type StepArgs } from "./derive.js";
import type { ActionKindDef } from "./types.js";

/**
 * D4's two writes. Erasure has no inverse (R3, ADR-17), so its card asks for the session id
 * the screen's own dialog asks for, and the reason stays the dialog's closed vocabulary
 * rather than anything a model wrote.
 */

const ERASURE_REASONS = ["subject_request", "retention_policy", "operator_error"] as const;

const FormIdArg = z.string().min(1).max(200);
const SessionIdArg = z.string().min(1).max(200);

const erase = routeArgs(
  EraseBody,
  {
    formId: FormIdArg,
    sessionId: SessionIdArg,
    // The dialog's closed vocabulary, which is narrower than the route's own string.
    reason: z
      .enum(ERASURE_REASONS)
      .describe("Why the data is being erased. It is recorded on the tombstone."),
  } satisfies StepArgs<typeof EraseBody.shape, never, "formId" | "sessionId">,
  { params: { formId: "id", sessionId: "sessionId" } },
);

const UnflagArgs = z.strictObject({
  formId: FormIdArg,
  sessionId: SessionIdArg,
});

export const eraseResponse: ActionKindDef = {
  kind: "response.erase",
  screen: "/operations/forms/[formId]/responses/[sessionId]",
  route: { method: "POST", path: "/admin/forms/{id}/responses/{sessionId}/erase" },
  cell: { resource: "response", action: "erase" },
  environmentFrom: "switcher",
  ...erase,
  references: [],
  // Never a count of answers or anything read off them: a tombstone's own fields only.
  resultAllowlist: ["sessionId", "environment", "alreadyErased"],
  card: {
    titleKey: "agent.card.response.erase.title",
    consequenceKeys: [
      "agent.card.response.erase.consequence",
      "agent.card.response.erase.tombstone",
    ],
    headingControl: "responses.erase",
    typedConfirmation: "sessionId",
  },
  description: ACTION_DESCRIPTIONS["response.erase"],
};

export const unflagResponse: ActionKindDef = {
  kind: "response.unflag",
  screen: "/operations/forms/[formId]/responses/[sessionId]",
  route: { method: "POST", path: "/admin/forms/{id}/responses/{sessionId}/unflag" },
  cell: { resource: "response", action: "dispose" },
  environmentFrom: "switcher",
  args: UnflagArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    sessionId: facts.params.sessionId ?? "",
  }),
  references: [],
  resultAllowlist: ["sessionId", "environment", "released"],
  card: {
    titleKey: "agent.card.response.unflag.title",
    consequenceKeys: ["agent.card.response.unflag.consequence"],
    headingControl: "responses.unflag",
  },
  description: ACTION_DESCRIPTIONS["response.unflag"],
};

/**
 * The export is a hand-off in the other direction: the bytes stream into the user's own browser, so none
 * reaches the agent code or the provider. It writes no agent audit row, because the export's own audit row
 * records the act. Its arguments are the export route's own query, which the screen's control sends.
 */
const ExportArgs = z.strictObject({
  formId: FormIdArg,
  format: stated(ExportQuery.shape.format).describe("The file format the download produces."),
  shape: stated(ExportQuery.shape.shape).describe(
    "One row per answer, or one row per submission. CSV only.",
  ),
  // A number rather than the query string's own text, because the card displays it.
  version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("The version whose shape the export follows. Required for a wide CSV."),
  from: stated(ExportQuery.shape.from)
    .max(40)
    .optional()
    .describe("The first day of the range, as YYYY-MM-DD."),
  to: stated(ExportQuery.shape.to)
    .max(40)
    .optional()
    .describe("The last day of the range, as YYYY-MM-DD."),
} satisfies StepArgs<typeof ExportQuery.shape, never, "formId">);

export const exportResponses: ActionKindDef = {
  kind: "response.export",
  screen: "/operations/forms/[formId]/responses",
  cell: { resource: "response", action: "export" },
  environmentFrom: "switcher",
  args: ExportArgs,
  recomputeArgs: () => ({}),
  references: [],
  // The filters the user chose, and nothing read out of the file.
  resultAllowlist: ["format", "shape", "version", "environment"],
  handOff: true,
  card: {
    titleKey: "agent.card.response.export.title",
    consequenceKeys: [
      "agent.card.response.export.consequence",
      "agent.card.response.export.handOff",
    ],
    headingControl: "responses.export",
  },
  description: ACTION_DESCRIPTIONS["response.export"],
};
