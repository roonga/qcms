// The plaintext secret lives in memory only long enough to be returned once and encrypted
// for storage; it is never logged and never returned on a read (SEC-6/SEC-8).

import type { RouteHandler } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { type FormId, parseFormId } from "@roonga/qcms-core";
import {
  deactivateWebhook,
  getEndpointProposal,
  getForm,
  getWebhook,
  insertWebhook,
  listOpenEndpointProposals,
  listWebhooks,
  updateWebhook,
  type EndpointProposalRow,
  type WebhookRow,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { twoPersonRuleApplies } from "../membership/two-person.js";
import { encryptWebhookSecret, generateWebhookSecret } from "./crypto.js";
import { endpointUrlFor } from "./mask.js";
import {
  confirmEndpointChange,
  newProposalId,
  proposalFailures,
  resumeEndpointProposal,
  withdrawEndpointChange,
  proposeEndpointChange,
  type EndpointChangeKind,
} from "./propose.js";
import { checkWebhookUrl, type WebhookUrlRejection } from "./ssrf.js";
import type {
  confirmEndpointProposalRoute,
  createWebhookRoute,
  deactivateWebhookRoute,
  listEndpointProposalsRoute,
  listWebhooksRoute,
  updateWebhookRoute,
  withdrawEndpointProposalRoute,
} from "./route.js";

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  webhookNotFound: (): ApiError =>
    new ApiError("WEBHOOK_NOT_FOUND", 404, "No such webhook for this form"),
  // Throws rather than recording an empty actor: the two-person rule cannot compare
  // against `""` while looking as though it could.
  noPrincipal: (): Error =>
    new Error("webhooks: no admin principal on a request that records an actor"),
  noWorkspace: (): Error =>
    new Error("webhooks: no workspace on a request whose act is recorded in one"),
  urlRejected: (reason: WebhookUrlRejection): ApiError =>
    new ApiError("WEBHOOK_URL_REJECTED", 422, urlRejectionMessage(reason), { reason }),
} as const;

// These messages must name no environment variable or other environment identifier:
// clients receive behavior, not flag values (ADR-24). Each one states only what the guard
// actually tested, since one flag lifts several rules.
function urlRejectionMessage(reason: WebhookUrlRejection): string {
  switch (reason) {
    case "not-a-url":
      return "The webhook URL is not a valid absolute URL";
    case "unsupported-scheme":
      return "The webhook URL must use http or https";
    case "https-required":
      return "This deployment delivers to https targets only";
    case "private-host":
      return "The webhook URL resolves to a private or reserved host, which this deployment does not deliver to";
  }
}

function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

// The executor is the caller's rather than resolved here: which environment a
// configuration screen is about is the request switcher's answer (ADR-40).
async function requireForm(exec: Executor, formId: FormId): Promise<void> {
  const form = await getForm(exec, formId);
  if (form === undefined) throw fail.formNotFound();
}

function newWebhookId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `whk_${hex}`;
}

function requireAllowedUrl(deps: Deps, raw: string): string {
  const checked = checkWebhookUrl(raw, deps.config.webhooks.allowPrivateTargets);
  if (!checked.ok) throw fail.urlRejected(checked.reason);
  return checked.url;
}

// The middleware decides `urlVisibility`, since that is the layer holding the caller's
// grants; this applies it, because this is what builds the body.
function toSummary(
  row: WebhookRow,
  urlVisibility: "whole" | "masked" | undefined,
): {
  webhookId: string;
  url: string;
  active: boolean;
  hasSecret: true;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    webhookId: row.webhookId,
    url: endpointUrlFor(row.url, urlVisibility),
    active: row.active,
    hasSecret: true,
    deactivatedAt: row.deactivatedAt === null ? null : row.deactivatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// All three come from what the middleware already established: re-resolving any of them
// would be a second chance to disagree with the decision that let the request through.
function actContext(
  deps: Deps,
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
): { readonly environment: string; readonly workspaceId: string; readonly actor: string } {
  const grant = c.get("grantContext");
  const principal = c.get("adminPrincipal");
  if (principal === undefined) throw fail.noPrincipal();
  // Refused rather than written: an audit row whose `workspace_id` is `""` answers nothing
  // while looking like an answer.
  const workspaceId = grant?.workspaceId;
  if (workspaceId === undefined || workspaceId === "") throw fail.noWorkspace();
  return {
    environment:
      grant?.environment ?? deps.databases.forRequest(c.get("requestEnvironment")).environment,
    workspaceId,
    actor: principal.userId,
  };
}

function proposalBody(
  row: EndpointProposalRow,
  urlVisibility: "whole" | "masked" | undefined,
): {
  proposalId: string;
  formId: string;
  environment: string;
  webhookId: string;
  kind: EndpointChangeKind;
  url: string | null;
  active: boolean | null;
  rotatesSecret: boolean;
  proposedBy: string;
  proposedAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  appliedAt: string | null;
} {
  return {
    proposalId: row.proposalId,
    formId: row.formId,
    environment: row.environment,
    webhookId: row.webhookId,
    kind: row.kind,
    url: row.url === null ? null : endpointUrlFor(row.url, urlVisibility),
    active: row.active,
    // A boolean, never the secret: the ciphertext does not leave the process and the
    // plaintext left once, at propose time.
    rotatesSecret: row.secretEncrypted !== null,
    proposedBy: row.proposedBy,
    proposedAt: row.proposedAt.toISOString(),
    confirmedBy: row.confirmedBy,
    confirmedAt: row.confirmedAt === null ? null : row.confirmedAt.toISOString(),
    appliedAt: row.appliedAt === null ? null : row.appliedAt.toISOString(),
  };
}

// The environment comparison is load-bearing: a caller authorised against `test`, where a
// `forms.editor` holds `webhook: configure`, must not reach a `prod` proposal by naming its
// id, and a mismatch is not-found so they learn nothing about `prod`. An applied proposal
// is returned rather than hidden, because what to say about one differs per route.
async function requireProposal(
  deps: Deps,
  input: {
    readonly proposalId: string;
    readonly formId: FormId;
    readonly environment: string;
  },
): Promise<EndpointProposalRow> {
  const proposal = await getEndpointProposal(deps.databases.control, input.proposalId);
  if (
    proposal === undefined ||
    proposal.formId !== input.formId ||
    proposal.environment !== input.environment ||
    proposal.withdrawnAt !== null
  ) {
    throw proposalFailures.notFound();
  }
  return proposal;
}

export function makeCreateWebhookHandler(
  deps: Deps,
): RouteHandler<typeof createWebhookRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");
    await requireForm(deps.databases.forRequest(c.get("requestEnvironment")).exec, formId);

    const url = requireAllowedUrl(deps, body.url);
    const secret = body.secret ?? generateWebhookSecret();
    const secretEncrypted = await encryptWebhookSecret(secret, deps.config.keys.app);
    // Minted before the branch, so a change held pending already names the endpoint it
    // will become and a repeated apply cannot mint a second one.
    const webhookId = newWebhookId();
    const act = actContext(deps, c);

    if (await twoPersonRuleApplies(deps.databases.control, act)) {
      const proposal = await proposeEndpointChange(deps, {
        proposalId: newProposalId(),
        formId,
        environment: act.environment,
        webhookId,
        kind: "create",
        url,
        secretEncrypted,
        active: body.active,
        proposedBy: act.actor,
        workspaceId: act.workspaceId,
      });
      return c.json(
        {
          pending: true as const,
          proposal: proposalBody(proposal, "whole"),
          secret, // one-time reveal (SEC-6)
        },
        202,
      );
    }

    const row = await insertWebhook(deps.databases.forRequest(c.get("requestEnvironment")).exec, {
      webhookId,
      formId,
      url,
      secretEncrypted,
      active: body.active,
    });

    return c.json(
      {
        webhookId: row.webhookId,
        formId,
        url: row.url,
        active: row.active,
        secret, // one-time reveal (SEC-6)
        createdAt: row.createdAt.toISOString(),
      },
      201,
    );
  };
}

export function makeListWebhooksHandler(
  deps: Deps,
): RouteHandler<typeof listWebhooksRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    await requireForm(deps.databases.forRequest(c.get("requestEnvironment")).exec, formId);

    const rows = await listWebhooks(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      formId,
    );
    // This read hands a stored URL to a caller who may not be allowed to set it, which is
    // what makes it the route that masks (Q58).
    const visibility = c.get("grantContext")?.endpointUrl;
    return c.json({ webhooks: rows.map((row) => toSummary(row, visibility)) }, 200);
  };
}

export function makeUpdateWebhookHandler(
  deps: Deps,
): RouteHandler<typeof updateWebhookRoute, ApiEnv> {
  return async (c) => {
    const { id, webhookId } = c.req.valid("param");
    const formId = requireFormId(id);
    const body = c.req.valid("json");

    const existing = await getWebhook(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      formId,
      webhookId,
    );
    if (existing === undefined) throw fail.webhookNotFound();

    const url = body.url === undefined ? undefined : requireAllowedUrl(deps, body.url);

    // Absent both flags the secret is untouched, so it is never re-revealed.
    const rotating = body.rotateSecret === true || body.secret !== undefined;
    let newSecret: string | undefined;
    let secretEncrypted: string | undefined;
    if (rotating) {
      newSecret = body.secret ?? generateWebhookSecret();
      secretEncrypted = await encryptWebhookSecret(newSecret, deps.config.keys.app);
    }

    // A pending change leaves the live row untouched, so nothing is delivered to the new
    // URL or signed with the new secret until a second account confirms.
    const act = actContext(deps, c);
    if (await twoPersonRuleApplies(deps.databases.control, act)) {
      const proposal = await proposeEndpointChange(deps, {
        proposalId: newProposalId(),
        formId,
        environment: act.environment,
        webhookId,
        kind: "update",
        url,
        secretEncrypted,
        active: body.active,
        proposedBy: act.actor,
        workspaceId: act.workspaceId,
      });
      return c.json(
        {
          pending: true as const,
          proposal: proposalBody(proposal, "whole"),
          ...(newSecret === undefined ? {} : { secret: newSecret }),
        },
        202,
      );
    }

    const updated = await updateWebhook(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      formId,
      webhookId,
      {
        ...(url === undefined ? {} : { url }),
        ...(secretEncrypted === undefined ? {} : { secretEncrypted }),
        ...(body.active === undefined ? {} : { active: body.active }),
        ...(body.active === undefined
          ? {}
          : { deactivatedAt: body.active ? null : deps.clock.now() }),
        now: deps.clock.now(),
      },
    );
    if (updated === undefined) throw fail.webhookNotFound();

    return c.json(
      {
        webhookId: updated.webhookId,
        url: updated.url,
        active: updated.active,
        deactivatedAt: updated.deactivatedAt === null ? null : updated.deactivatedAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        ...(newSecret === undefined ? {} : { secret: newSecret }), // one-time reveal (SEC-6)
      },
      200,
    );
  };
}

export function makeDeactivateWebhookHandler(
  deps: Deps,
): RouteHandler<typeof deactivateWebhookRoute, ApiEnv> {
  return async (c) => {
    const { id, webhookId } = c.req.valid("param");
    const formId = requireFormId(id);

    // A deactivation is an endpoint change like the other two, so it is not a way round
    // the rule: the endpoint goes on delivering until the deactivation is confirmed.
    const act = actContext(deps, c);
    if (await twoPersonRuleApplies(deps.databases.control, act)) {
      const existing = await getWebhook(
        deps.databases.forRequest(c.get("requestEnvironment")).exec,
        formId,
        webhookId,
      );
      if (existing === undefined) throw fail.webhookNotFound();
      const proposal = await proposeEndpointChange(deps, {
        proposalId: newProposalId(),
        formId,
        environment: act.environment,
        webhookId,
        kind: "deactivate",
        proposedBy: act.actor,
        workspaceId: act.workspaceId,
      });
      return c.json({ pending: true as const, proposal: proposalBody(proposal, "whole") }, 202);
    }

    const row = await deactivateWebhook(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      formId,
      webhookId,
      deps.clock.now(),
    );
    if (row === undefined) throw fail.webhookNotFound();

    return c.json(
      {
        webhookId: row.webhookId,
        active: false as const,
        deactivatedAt: (row.deactivatedAt ?? deps.clock.now()).toISOString(),
      },
      200,
    );
  };
}

// Gated as an endpoint read, which is workspace-wide and environment-agnostic in the
// matrix (Q39); only the write actions are environment-scoped. The switcher decides which
// environment's pending list is shown.
export function makeListEndpointProposalsHandler(
  deps: Deps,
): RouteHandler<typeof listEndpointProposalsRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    await requireForm(deps.databases.forRequest(c.get("requestEnvironment")).exec, formId);

    const environment = deps.databases.forRequest(c.get("requestEnvironment")).environment;
    const rows = await listOpenEndpointProposals(deps.databases.control, formId, environment);
    const visibility = c.get("grantContext")?.endpointUrl;
    return c.json({ proposals: rows.map((row) => proposalBody(row, visibility)) }, 200);
  };
}

// A proposal already claimed by a different account and not yet applied is resumed rather
// than confirmed again, so the confirming account of record stays whoever claimed it.
export function makeConfirmEndpointProposalHandler(
  deps: Deps,
): RouteHandler<typeof confirmEndpointProposalRoute, ApiEnv> {
  return async (c) => {
    const { id, proposalId } = c.req.valid("param");
    const formId = requireFormId(id);
    const act = actContext(deps, c);
    const proposal = await requireProposal(deps, {
      proposalId,
      formId,
      environment: act.environment,
    });

    // Already applied is an idempotent success: the loser of two concurrent confirms has
    // the end state they asked for. The proposer is still refused, because the rule does
    // not stop applying once the change has landed.
    if (proposal.appliedAt !== null) {
      if (proposal.proposedBy === act.actor) throw proposalFailures.selfConfirmation();
      return c.json({ proposal: proposalBody(proposal, "whole") }, 200);
    }

    const settled =
      proposal.confirmedAt === null
        ? await confirmEndpointChange(deps, {
            proposal,
            confirmedBy: act.actor,
            workspaceId: act.workspaceId,
          })
        : await resumeEndpointProposal(deps, { proposal, confirmedBy: act.actor });

    return c.json({ proposal: proposalBody(settled, "whole") }, 200);
  };
}

// Either account may withdraw, and a confirmed proposal whose apply has not landed can be
// withdrawn too: the `one_open` index holds the endpoint claimed while such a row exists,
// so without this door a broken environment pool would block that endpoint forever.
export function makeWithdrawEndpointProposalHandler(
  deps: Deps,
): RouteHandler<typeof withdrawEndpointProposalRoute, ApiEnv> {
  return async (c) => {
    const { id, proposalId } = c.req.valid("param");
    const formId = requireFormId(id);
    const act = actContext(deps, c);
    const proposal = await requireProposal(deps, {
      proposalId,
      formId,
      environment: act.environment,
    });

    // This is what refuses an applied proposal: `requireProposal` returns one on purpose.
    if (proposal.appliedAt !== null) throw proposalFailures.notPending();

    const withdrawn = await withdrawEndpointChange(deps, {
      proposal,
      withdrawnBy: act.actor,
      workspaceId: act.workspaceId,
    });
    return c.json({ proposal: proposalBody(withdrawn, "whole") }, 200);
  };
}
