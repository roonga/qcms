/**
 * Webhook-config admin handlers (task 024, SEC-6).
 *
 * Honest transaction scripts (R5): the slice validates the target URL against
 * the SSRF policy, encrypts the secret at rest, and reads/writes `webhooks` rows
 * through `@roonga/qcms-db` - no cross-row invariant lives in the kernel here. Handlers
 * are fetch-pure (R4): time via `deps.clock`, crypto via WebCrypto
 * (`./crypto.js`), no `node:*`.
 *
 * **Secret handling (SEC-6/SEC-8).** The plaintext secret exists in memory only
 * long enough to (a) return it once, on create or explicit rotate, and (b)
 * encrypt it for storage. It is never logged and never returned on a read. The
 * stored column holds AES-256-GCM ciphertext under `QCMS_APP_KEY`; 025 decrypts
 * it to sign deliveries.
 *
 * Row types come straight from `@roonga/qcms-db`: the `webhooks` row is enum-free and
 * the enum-bearing `forms` row is now hand-authored and sound across the package
 * boundary (issue #5), so both are consumed directly with no local launder.
 */

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

// --- typed failures ---------------------------------------------------------

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  webhookNotFound: (): ApiError =>
    new ApiError("WEBHOOK_NOT_FOUND", 404, "No such webhook for this form"),
  /**
   * No admin principal on a request that records an actor.
   *
   * A `500` rather than an empty `proposed_by`: a proposal whose proposing account is `""`
   * is a proposal the two-person rule cannot compare against, while looking as though it
   * could. The admin-auth gate makes this unreachable in a mounted process.
   */
  noPrincipal: (): Error =>
    new Error("webhooks: no admin principal on a request that records an actor"),
  /**
   * No workspace on a request whose act is recorded in one.
   *
   * A `500`, for the same reason {@link fail.noPrincipal} is: the audit row's
   * `workspace_id` is established by the middleware before any handler runs, and a row
   * carrying `""` answers nothing while looking like an answer.
   */
  noWorkspace: (): Error =>
    new Error("webhooks: no workspace on a request whose act is recorded in one"),
  urlRejected: (reason: WebhookUrlRejection): ApiError =>
    new ApiError("WEBHOOK_URL_REJECTED", 422, urlRejectionMessage(reason), { reason }),
} as const;

/**
 * The developer-facing sentence for one rejection reason.
 *
 * The machine-readable half is `details.reason`, and that is what a client renders
 * from: the admin maps the four reasons onto its own catalog (ADR-27), so this text
 * is for an API consumer reading the envelope directly and is never the operator's
 * sentence.
 *
 * **It names no environment variable.** These two messages used to end "set
 * QCMS_WEBHOOK_ALLOW_PRIVATE for on-prem targets", which is an environment
 * identifier in a response body. ADR-24's "clients receive behavior, not flag
 * values" has been absolute since the Code Owner removed its one standing exception
 * on 2026-08-31 (issue #725), and the Code Owner widened it on 2026-09-12 to cover
 * any environment identifier rather than only the `QCMS_FLAG_` registry. A
 * deployment's operator finds the override in `docs/operations.md`, where changing
 * it is possible; a client reading this envelope cannot act on the name and should
 * not be told it.
 *
 * **Each message states only what the guard actually tested.** `https-required`
 * briefly read "must use https, because this deployment does not allow private
 * targets", which asserts something about the caller's URL that the check never
 * established: a public host on plain http is refused here too, and a consumer
 * reading that sentence would go looking for a private address it does not have.
 * One flag lifts both rules (`ssrf.ts`), which is what made the phrasing tempting
 * and does not make it true. The https rule is a delivery policy, so it is stated
 * as one, in the same words the admin's own catalog uses for this reason.
 */
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

// --- shared helpers ---------------------------------------------------------

function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

/**
 * 404 unless the form exists, read on the pool the request is served from.
 *
 * The executor is the caller's rather than resolved here, because which environment a
 * webhook configuration screen is about is the Q6 switcher's answer and the handler is
 * what holds the request (ADR-40, task 065).
 */
async function requireForm(exec: Executor, formId: FormId): Promise<void> {
  const form = await getForm(exec, formId);
  if (form === undefined) throw fail.formNotFound();
}

/** A fresh `whk_` id: 16 random hex bytes (config infrastructure, not a domain id). */
function newWebhookId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `whk_${hex}`;
}

/** Validate the target URL against the SSRF policy or throw a 422. */
function requireAllowedUrl(deps: Deps, raw: string): string {
  const checked = checkWebhookUrl(raw, deps.config.webhooks.allowPrivateTargets);
  if (!checked.ok) throw fail.urlRejected(checked.reason);
  return checked.url;
}

/**
 * Map a stored row to the summary shape (which never includes the secret).
 *
 * `urlVisibility` is Q58's: `"whole"` for a `forms.editor` and above, anything else for a
 * `forms.viewer`, whose query string is replaced **in this response** rather than in the
 * admin's rendering, so a second client of the same route sees the same masking. The
 * middleware decided it, because that is the layer holding the caller's grants; this
 * applies it, because this is what builds the body.
 */
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

// --- the two-person rule's half of a configure act (Q30, Q51; task 070) -----

/**
 * The request's environment, its workspace, and the account performing the act, which is
 * what the two-person rule needs and what every route below reads the same way.
 *
 * All three come from **what the middleware already established** rather than from a second
 * resolution: the environment is the one the act was authorised for, the workspace is the
 * one the form's owner resolved to, and the principal is the admin gate's. A handler that
 * re-resolved any of them would be a second chance to disagree with the decision that let
 * the request through.
 */
function actContext(
  deps: Deps,
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
): { readonly environment: string; readonly workspaceId: string; readonly actor: string } {
  const grant = c.get("grantContext");
  const principal = c.get("adminPrincipal");
  if (principal === undefined) throw fail.noPrincipal();
  // A configure route's row is a `form` workspace row, so the middleware resolved one. An
  // absent or empty workspace is **refused rather than written**: it would make a SEC-15
  // row whose `workspace_id` answers nothing while looking like an answer, which is the
  // same reasoning the release record uses for an empty actor. Unreachable in a mounted
  // process, which is why it throws rather than degrading.
  const workspaceId = grant?.workspaceId;
  if (workspaceId === undefined || workspaceId === "") throw fail.noWorkspace();
  return {
    environment:
      grant?.environment ?? deps.databases.forRequest(c.get("requestEnvironment")).environment,
    workspaceId,
    actor: principal.userId,
  };
}

/** One proposal as a response body, with Q58's masking applied to the proposed URL. */
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
    // The ciphertext never leaves the process and the plaintext left once, at propose
    // time. What a reader needs is whether confirming this change will also rotate the
    // signing secret, which is a boolean.
    rotatesSecret: row.secretEncrypted !== null,
    proposedBy: row.proposedBy,
    proposedAt: row.proposedAt.toISOString(),
    confirmedBy: row.confirmedBy,
    confirmedAt: row.confirmedAt === null ? null : row.confirmedAt.toISOString(),
    appliedAt: row.appliedAt === null ? null : row.appliedAt.toISOString(),
  };
}

/**
 * The proposal a `{proposalId}` names, in **this form and this environment**, or a 404.
 *
 * The environment comparison is the load-bearing line. The confirm and the withdraw take
 * their environment from the Q6 switcher, so a caller who selected `test` is authorised
 * against `test` - where a `forms.editor` holds `webhook: configure` - and a handler that
 * then acted on a `prod` proposal would be the exact bypass PR #1061's review found one
 * route over. So the proposal's own environment has to be the one the request was
 * authorised for, and a mismatch is **not found** rather than forbidden: a caller scoped to
 * `test` learns nothing about what is pending in `prod`.
 *
 * A **withdrawn** proposal is not found either: it was applied to nothing and is over, and
 * a caller naming one learns no more than that. An **applied** one is returned, because
 * what to say about it differs per route and only the caller knows which it is - confirming
 * an applied change is the end state that caller asked for, and withdrawing one is refused
 * because the change is live (PR #1100's review, finding 7).
 */
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

// --- POST /admin/forms/:id/webhooks -----------------------------------------

export function makeCreateWebhookHandler(
  deps: Deps,
): RouteHandler<typeof createWebhookRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");
    await requireForm(deps.databases.forRequest(c.get("requestEnvironment")).exec, formId);

    const url = requireAllowedUrl(deps, body.url);
    // Secret: caller-supplied or generated. Shown once, encrypted for storage.
    const secret = body.secret ?? generateWebhookSecret();
    const secretEncrypted = await encryptWebhookSecret(secret, deps.config.keys.app);
    // The id is minted **before** the branch, so a change held pending already names the
    // endpoint it will become: the apply is then idempotent by id and a repeated apply
    // cannot mint a second endpoint.
    const webhookId = newWebhookId();
    const act = actContext(deps, c);

    // **The two-person rule** (Q30, Q51; task 070). A new `prod` endpoint in a workspace
    // whose `requireSecondApprover` switch is on is stored pending and delivers nothing to
    // the new URL until a different `forms.approver` confirms it. Outside `prod`, and with
    // the switch off, this is exactly the create task 024 built.
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
          secret, // one-time reveal (SEC-6); nothing signs with it until the change applies
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

// --- GET /admin/forms/:id/webhooks ------------------------------------------

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
    // Q58: the endpoint read is the one route that hands a stored URL to a caller who may
    // not be allowed to set it, so it is the one route that masks.
    const visibility = c.get("grantContext")?.endpointUrl;
    return c.json({ webhooks: rows.map((row) => toSummary(row, visibility)) }, 200);
  };
}

// --- PUT /admin/forms/:id/webhooks/:webhookId -------------------------------

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

    // Rotation is explicit: `rotateSecret: true` (generate) or an explicit
    // `secret`. Absent both, the secret is untouched and never re-revealed.
    const rotating = body.rotateSecret === true || body.secret !== undefined;
    let newSecret: string | undefined;
    let secretEncrypted: string | undefined;
    if (rotating) {
      newSecret = body.secret ?? generateWebhookSecret();
      secretEncrypted = await encryptWebhookSecret(newSecret, deps.config.keys.app);
    }

    // **The two-person rule** (Q30, Q51). The live row is untouched: a pending change
    // delivers nothing to the new URL and signs nothing with the new secret, so the
    // endpoint goes on doing what the account that configured it last was agreed to do.
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
        // Reactivating clears the deactivation stamp; deactivating stamps it.
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
        ...(newSecret === undefined ? {} : { secret: newSecret }), // one-time reveal
      },
      200,
    );
  };
}

// --- DELETE /admin/forms/:id/webhooks/:webhookId ----------------------------

export function makeDeactivateWebhookHandler(
  deps: Deps,
): RouteHandler<typeof deactivateWebhookRoute, ApiEnv> {
  return async (c) => {
    const { id, webhookId } = c.req.valid("param");
    const formId = requireFormId(id);

    // **The two-person rule** (Q30, Q51). A deactivation is an endpoint change like the
    // other two: it stops a consumer that an agreed configuration feeds, and whether that
    // is the right thing to do is the question a second approver reads. It is **not** a
    // way round the rule in either direction - the endpoint goes on delivering until the
    // deactivation is confirmed, which is the same "takes effect on nothing" the other two
    // acts have.
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

// --- GET /admin/forms/:id/webhooks/proposals ---------------------------------

/**
 * What is waiting for a second approver, in the environment the Q6 switcher has selected
 * (criterion 7).
 *
 * The **endpoint read's** cell, like the endpoint list beside it, and it names no
 * environment on its row for the same reason that one does not: a configuration read is
 * workspace-wide and environment-agnostic in the matrix (Q39), because authoring roles are
 * workspace-wide and only the write actions are environment-scoped. The handler reads the
 * switcher to decide which environment's pending list to show, exactly as the endpoint list
 * reads it to decide which environment's endpoints to show.
 *
 * So a `forms.viewer` sees that a production endpoint change is waiting - which is the
 * read that role has - with the proposed URL's query string masked (Q58).
 */
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

// --- POST /admin/forms/:id/webhooks/proposals/:proposalId/confirm ------------

/**
 * Confirm a pending endpoint change, which is the second of Q51's two acts.
 *
 * Three refusals, and each is one of criterion 7's clauses:
 *
 *   - **the proposer cannot confirm their own proposal**, which is the rule itself;
 *   - **a caller without `forms.approver` holding `prod` in scope cannot confirm**, which
 *     the middleware refused before this ran: the row is `webhook: configure` in the
 *     switcher's environment, and the matrix's production split means a `forms.editor`
 *     holding `prod` is still refused it (069's `policy.ts`);
 *   - **a proposal in another environment is not found**, so a caller authorised against
 *     `test` cannot reach a `prod` change by naming its id.
 *
 * A proposal already claimed by a different account and not yet applied is **resumed**
 * rather than confirmed again: the confirming account of record stays whoever claimed it,
 * no second audit row is written, and the apply completes. That is the cost of the proposal
 * and the endpoint living on two pools, and it is paid in the direction that never leaves a
 * production endpoint live without a recorded confirmation.
 */
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

    // **Already applied is an idempotent success.** Two approvers pressing Confirm on an
    // unapplied row within one round trip is the window: the winner stamps `applied_at`
    // and the loser arrives here with the end state they asked for already reached. There
    // is nothing to retry and nothing wrong with their request, so the answer is the row
    // (PR #1100's review, finding 7). The proposer is still refused, because the one rule
    // this mechanism exists for does not stop applying once the change has landed.
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

// --- DELETE /admin/forms/:id/webhooks/proposals/:proposalId ------------------

/**
 * Withdraw a pending endpoint change.
 *
 * **Either account may withdraw**: the proposer changing their mind and a second approver
 * refusing the change are the same act on the row, and which it was is in the audit. There
 * is no separate "reject", because a rejection that left the row in a third state would be
 * a third thing for a screen to explain and the record already says who ended it.
 *
 * **A confirmed proposal whose apply has not landed can be withdrawn too**, and that is the
 * operator's way out of a persistently failing apply: the `one_open` index holds the
 * endpoint claimed while such a row exists, so without this door a broken environment pool
 * would mean no new proposal for that endpoint is ever accepted. It is safe because nothing
 * is live to unpick - `applied_at is null` is exactly that - and the row keeps both
 * accounts. An **applied** proposal is not withdrawable: `requireProposal` treats it as
 * absent, the statement's predicate refuses it and the `one_outcome` CHECK refuses it a
 * third time, because the change is live and reversing it is a new proposal.
 */
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

    // An applied change is live and reversing it is a new proposal, so this is the state
    // mismatch the `one_outcome` CHECK and the statement's predicate both refuse. A 409
    // rather than a 404: the row exists and the caller can read why.
    if (proposal.appliedAt !== null) throw proposalFailures.notPending();

    const withdrawn = await withdrawEndpointChange(deps, {
      proposal,
      withdrawnBy: act.actor,
      workspaceId: act.workspaceId,
    });
    return c.json({ proposal: proposalBody(withdrawn, "whole") }, 200);
  };
}
