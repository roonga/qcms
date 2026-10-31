import { z } from "zod";

import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/**
 * A created or rotated secret reaches the user's card once and is on no allowlist, so it
 * cannot travel into the next turn (SEC-6, SEC-8). Three of these kinds share one route
 * and method, so each declares the body member set that tells it apart.
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
  screen: "/forms/[formId]/webhooks",
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
  description:
    "Configure a new delivery endpoint for this form in the current environment. Its " +
    "signing secret is shown to the user once and is never returned to you.",
};

export const rotateWebhookSecret: ActionKindDef = {
  kind: "webhook.rotate",
  screen: "/forms/[formId]/webhooks",
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
  description:
    "Replace an endpoint's signing secret. Deliveries signed with the old one stop " +
    "verifying, and the new secret is shown to the user once.",
};

export const reactivateWebhook: ActionKindDef = {
  kind: "webhook.reactivate",
  screen: "/forms/[formId]/webhooks",
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
  description: "Put a deactivated endpoint back in service in the current environment.",
};

export const retargetWebhook: ActionKindDef = {
  kind: "webhook.retarget",
  screen: "/forms/[formId]/webhooks",
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
  description:
    "Point an endpoint at another URL. The card shows the endpoint's current target and " +
    "the new one in full, query string included.",
};

export const deactivateWebhook: ActionKindDef = {
  kind: "webhook.deactivate",
  screen: "/forms/[formId]/webhooks",
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
  description:
    "Stop delivering to an endpoint. The row and its delivery history stay, and a " +
    "delivery already in flight keeps its own retry state.",
};

export const redeliverDelivery: ActionKindDef = {
  kind: "webhook.redeliver",
  screen: "/forms/[formId]/webhooks",
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
  description:
    "Reset one dead-lettered delivery to due-now, so the worker attempts it again. It " +
    "reads no part of the payload.",
};
