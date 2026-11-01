import { z } from "zod";

import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/**
 * D4's two writes. Erasure has no inverse (R3, ADR-17), so its card asks for the session id
 * the screen's own dialog asks for, and the reason stays the dialog's closed vocabulary
 * rather than anything a model wrote.
 */

const ERASURE_REASONS = ["subject_request", "retention_policy", "operator_error"] as const;

const EraseArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  reason: z
    .enum(ERASURE_REASONS)
    .describe("Why the data is being erased. It is recorded on the tombstone."),
});

const UnflagArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
});

function bodyMember(facts: ActionRequestFacts, name: string): unknown {
  return typeof facts.body === "object" && facts.body !== null
    ? (facts.body as Record<string, unknown>)[name]
    : undefined;
}

export const eraseResponse: ActionKindDef = {
  kind: "response.erase",
  screen: "/operations/forms/[formId]/responses/[sessionId]",
  route: { method: "POST", path: "/admin/forms/{id}/responses/{sessionId}/erase" },
  cell: { resource: "response", action: "erase" },
  environmentFrom: "switcher",
  args: EraseArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    sessionId: facts.params.sessionId ?? "",
    reason: bodyMember(facts, "reason"),
  }),
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
  description:
    "Erase one respondent's answers and submission, recording a tombstone. It cannot be " +
    "undone, and the user retypes the session id on the card before it can run.",
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
  description:
    "Release one flagged response's withheld submission event, so its consumers receive it.",
};

/**
 * The export is a hand-off in the other direction: the bytes stream into the user's own
 * browser, so none reaches the agent code or the provider. It writes no agent audit row,
 * because the export's own SEC-15 row records the act.
 */
const ExportArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  format: z.enum(["csv", "json"]).describe("The file format the download produces."),
  shape: z
    .enum(["long", "wide"])
    .describe("One row per answer, or one row per submission. CSV only."),
  version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("The version whose shape the export follows. Required for a wide CSV."),
  from: z.string().max(40).optional().describe("The first day of the range, as YYYY-MM-DD."),
  to: z.string().max(40).optional().describe("The last day of the range, as YYYY-MM-DD."),
});

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
  description:
    "Open the export dialog with these filters. The user presses Export and the file " +
    "downloads in their browser; no part of it is returned to you.",
};
