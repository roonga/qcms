import { z } from "zod";

import { CreateWebhookBody, UpdateWebhookBody } from "../../webhooks/schema.js";
import { ACTION_DESCRIPTIONS } from "../prompts/prompts.generated.js";
import { routeArgs, stated, type StepArgs } from "./derive.js";
import type { ActionKindDef } from "./types.js";

/**
 * A created or rotated secret reaches the user's card once and is on no allowlist, so it cannot travel into
 * the next turn. Three of these kinds share one route and method, so each declares the body member set that
 * tells it apart.
 */

const ENDPOINT_PATH = "/admin/forms/{id}/webhooks/{webhookId}";

// Narrower than the route's own member, which takes any string: an endpoint is a URL.
const Url = z
  .url()
  .max(2000)
  .describe("The endpoint's full URL, with its query string if it has one.");

const FormIdArg = z.string().min(1).max(200);
const WebhookIdArg = z.string().min(1).max(200);

const create = routeArgs(
  CreateWebhookBody,
  {
    formId: FormIdArg,
    url: Url,
    active: stated(CreateWebhookBody.shape.active).describe("Whether deliveries start at once."),
  } satisfies StepArgs<typeof CreateWebhookBody.shape, "secret", "formId">,
  // The signing secret is the route's to mint: no card carries one in its arguments.
  { unnamed: ["secret"], params: { formId: "id" } },
);

// The kind is the act, so the update body holds nothing a step chooses: a rotate sends
// `rotateSecret`, a reactivate sends `active`, and the endpoint itself is the path's.
const ENDPOINT_ARGS = {
  formId: FormIdArg,
  webhookId: WebhookIdArg,
} satisfies StepArgs<
  typeof UpdateWebhookBody.shape,
  "url" | "active" | "rotateSecret" | "secret",
  "formId" | "webhookId"
>;

const ENDPOINT_PARAMS = { formId: "id", webhookId: "webhookId" } as const;

const endpoint = routeArgs(UpdateWebhookBody, ENDPOINT_ARGS, {
  unnamed: ["url", "active", "rotateSecret", "secret"],
  params: ENDPOINT_PARAMS,
});

const retarget = routeArgs(
  UpdateWebhookBody,
  {
    ...ENDPOINT_ARGS,
    url: Url,
  } satisfies StepArgs<
    typeof UpdateWebhookBody.shape,
    "active" | "rotateSecret" | "secret",
    "formId" | "webhookId"
  >,
  { unnamed: ["active", "rotateSecret", "secret"], params: ENDPOINT_PARAMS },
);

const RedeliverArgs = z.strictObject({
  formId: FormIdArg,
  deliveryId: z.string().min(1).max(200),
});

export const createWebhook: ActionKindDef = {
  kind: "webhook.create",
  screen: "/operations/forms/[formId]/webhooks",
  route: { method: "POST", path: "/admin/forms/{id}/webhooks" },
  cell: { resource: "webhook", action: "configure" },
  environmentFrom: "switcher",
  ...create,
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
  ...endpoint,
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
  ...endpoint,
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
  ...retarget,
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
  args: z.strictObject(ENDPOINT_ARGS),
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
