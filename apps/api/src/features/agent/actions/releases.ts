import { z } from "zod";

import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/**
 * The two kinds whose environment comes from their own arguments, which is why the token
 * binds the environment per step: "release v3 to test, then promote it to prod" is one
 * plan with two environments, each verified on its own step (review finding B1).
 */

const ReleaseArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  version: z.number().int().min(1).max(1_000_000),
  environment: z.string().min(1).max(53),
  fromEnvironment: z.string().min(1).max(53).optional(),
});

const PublishArgs = z.strictObject({
  formId: z.string().min(1).max(200),
});

function bodyMember(facts: ActionRequestFacts, name: string): unknown {
  return typeof facts.body === "object" && facts.body !== null
    ? (facts.body as Record<string, unknown>)[name]
    : undefined;
}

export const publishForm: ActionKindDef = {
  kind: "form.publish",
  screen: "/forms/[formId]",
  route: { method: "POST", path: "/admin/forms/{id}/publish" },
  cell: { resource: "form", action: "publish" },
  // Publishing releases a version nowhere, so the switcher's environment is what it is
  // performed in and the route names none.
  environmentFrom: "switcher",
  args: PublishArgs,
  recomputeArgs: (facts) => ({ formId: facts.params.id ?? "" }),
  references: ["version"],
  resultAllowlist: ["version"],
  card: {
    titleKey: "agent.card.form.publish.title",
    consequenceKeys: ["agent.card.form.publish.consequence"],
    headingControl: "builder.publish",
  },
  description:
    "Publish the form's working draft as a new immutable version. It releases the version " +
    "to no environment.",
};

export const releaseVersion: ActionKindDef = {
  kind: "form.release",
  screen: "/forms/[formId]/releases",
  route: { method: "POST", path: "/admin/forms/{id}/releases" },
  cell: { resource: "release", action: "create" },
  environmentFrom: "argument",
  environmentArgument: "environment",
  args: ReleaseArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    version: bodyMember(facts, "version"),
    environment: bodyMember(facts, "environment"),
    ...(bodyMember(facts, "fromEnvironment") === undefined
      ? {}
      : { fromEnvironment: bodyMember(facts, "fromEnvironment") }),
  }),
  references: ["version", "environment"],
  resultAllowlist: ["version", "environment", "replacedVersion"],
  card: {
    titleKey: "agent.card.form.release.title",
    consequenceKeys: [
      "agent.card.form.release.consequence",
      "agent.card.environment.production",
    ],
    headingControl: "releases.release",
  },
  description:
    "Release, promote or roll back a published version to one environment. The two-person " +
    "rule and the production approval apply exactly as they do on the screen.",
};
