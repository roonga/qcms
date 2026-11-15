import { z } from "zod";

import { ACTION_DESCRIPTIONS } from "../prompts/prompts.generated.js";
import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/**
 * A created or rotated secret reaches the user's card once and is on no allowlist, so it cannot travel into
 * the next turn. Three of these kinds share one route and method, so each declares the body member set that
 * tells it apart.
 */

const ENDPOINT_PATH = "/admin/forms/{id}/webhooks/{webhookId}";

const Url = z
  .url()
  .max(2000)
  .describe("The endpoint's full URL, with its query string if it has one.");

const CreateArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  url: Url,
  active: z.boolean().describe("Whether deliveries start at once."),
});

const EndpointArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  webhookId: z.string().min(1).max(200),
});

const RetargetArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  webhookId: z.string().min(1).max(200),
  url: Url,
});

const RedeliverArgs = z.strictObject({
  formId: z.string().min(1).max(200),
  deliveryId: z.string().min(1).max(200),
});

function bodyMember(facts: ActionRequestFacts, name: string): unknown {
  return typeof facts.body === "object" && facts.body !== null
    ? (facts.body as Record<string, unknown>)[name]
    : undefined;
}

export const createWebhook: ActionKindDef = {
  kind: "webhook.create",
  screen: "/operations/forms/[formId]/webhooks",
  route: { method: "POST", path: "/admin/forms/{id}/webhooks" },
  cell: { resource: "webhook", action: "configure" },
  environmentFrom: "switcher",
  args: CreateArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    url: bodyMember(facts, "url"),
    active: bodyMember(facts, "active"),
  }),
  references: ["webhookId"],
  // Never `secret`: the one place the plaintext exists is the screen that asked for it.
  resultAllowlist: ["webhookId", "environment", "active"],
  card: {
    titleKey: "agent.card.webhook.create.title",
    consequenceKeys: ["agent.card.webhook.create.consequence", "agent.card.webhook.create.secret"],
    headingControl: "webhooks.create",
  },
  description: ACTION_DESCRIPTIONS["webhook.create"],
};

export const rotateWebhookSecret: ActionKindDef = {
  kind: "webhook.rotate",
  screen: "/operations/forms/[formId]/webhooks",
  route: { method: "PUT", path: ENDPOINT_PATH, bodyMembers: ["rotateSecret"] },
  cell: { resource: "webhook", action: "configure" },
  environmentFrom: "switcher",
  args: EndpointArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    webhookId: facts.params.webhookId ?? "",
  }),
  references: ["webhookId"],
  resultAllowlist: ["webhookId", "environment"],
  card: {
    titleKey: "agent.card.webhook.rotate.title",
    consequenceKeys: ["agent.card.webhook.rotate.consequence", "agent.card.webhook.create.secret"],
    headingControl: "webhooks.rotate",
  },
  description: ACTION_DESCRIPTIONS["webhook.rotate"],
};

export const reactivateWebhook: ActionKindDef = {
  kind: "webhook.reactivate",
  screen: "/operations/forms/[formId]/webhooks",
  route: { method: "PUT", path: ENDPOINT_PATH, bodyMembers: ["active"] },
  cell: { resource: "webhook", action: "configure" },
  environmentFrom: "switcher",
  args: EndpointArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    webhookId: facts.params.webhookId ?? "",
  }),
  references: ["webhookId"],
  resultAllowlist: ["webhookId", "environment"],
  card: {
    titleKey: "agent.card.webhook.reactivate.title",
    consequenceKeys: ["agent.card.webhook.reactivate.consequence"],
    headingControl: "webhooks.activation",
  },
  description: ACTION_DESCRIPTIONS["webhook.reactivate"],
};

export const retargetWebhook: ActionKindDef = {
  kind: "webhook.retarget",
  screen: "/operations/forms/[formId]/webhooks",
  route: { method: "PUT", path: ENDPOINT_PATH, bodyMembers: ["url"] },
  cell: { resource: "webhook", action: "configure" },
  environmentFrom: "switcher",
  args: RetargetArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    webhookId: facts.params.webhookId ?? "",
    url: bodyMember(facts, "url"),
  }),
  references: ["webhookId"],
  resultAllowlist: ["webhookId", "environment"],
  card: {
    titleKey: "agent.card.webhook.retarget.title",
    consequenceKeys: ["agent.card.webhook.retarget.consequence"],
    headingControl: "webhooks.retarget",
  },
  description: ACTION_DESCRIPTIONS["webhook.retarget"],
};

export const deactivateWebhook: ActionKindDef = {
  kind: "webhook.deactivate",
  screen: "/operations/forms/[formId]/webhooks",
  route: { method: "DELETE", path: ENDPOINT_PATH },
  cell: { resource: "webhook", action: "configure" },
  environmentFrom: "switcher",
  args: EndpointArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    webhookId: facts.params.webhookId ?? "",
  }),
  references: ["webhookId"],
  resultAllowlist: ["webhookId", "environment"],
  card: {
    titleKey: "agent.card.webhook.deactivate.title",
    consequenceKeys: ["agent.card.webhook.deactivate.consequence"],
    headingControl: "webhooks.activation",
  },
  description: ACTION_DESCRIPTIONS["webhook.deactivate"],
};

export const redeliverDelivery: ActionKindDef = {
  kind: "webhook.redeliver",
  screen: "/operations/forms/[formId]/webhooks",
  route: { method: "POST", path: "/admin/forms/{id}/deliveries/{deliveryId}/redeliver" },
  cell: { resource: "webhook", action: "configure" },
  environmentFrom: "switcher",
  args: RedeliverArgs,
  recomputeArgs: (facts) => ({
    formId: facts.params.id ?? "",
    deliveryId: facts.params.deliveryId ?? "",
  }),
  references: ["deliveryId"],
  resultAllowlist: ["deliveryId", "environment", "queued"],
  card: {
    titleKey: "agent.card.webhook.redeliver.title",
    consequenceKeys: ["agent.card.webhook.redeliver.consequence"],
    headingControl: "deadletters.redeliver",
  },
  description: ACTION_DESCRIPTIONS["webhook.redeliver"],
};
