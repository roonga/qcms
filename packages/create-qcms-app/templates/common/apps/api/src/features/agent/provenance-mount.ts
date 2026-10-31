/**
 * The provenance check as the admin group mounts it (SEC-17). It runs after the grant
 * check, so a request carrying a token is authorised by exactly the policy that authorises
 * the same request without one, and a token that fails is refused rather than served.
 */

import { listProposalSteps } from "@roonga/qcms-db";
import type { MiddlewareHandler } from "hono";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { policyForRequest } from "../membership/route-policy.js";
import { actionKindForRoute } from "./actions/registry.js";
import type { ActionRequestFacts } from "./actions/types.js";
import { unverifiedProposalId, type ProposalRefusalCode } from "./proposal-token.js";
import {
  checkProvenance,
  provenanceMessage,
  PROPOSAL_HEADER,
  PROPOSAL_STEP_HEADER,
  type RecordedStep,
  type VerifiedProposal,
} from "./provenance.js";

function refusal(code: ProposalRefusalCode): ApiError {
  return new ApiError(code, 403, provenanceMessage(code));
}

/** With the flag off this deployment mints no token, so one presented here is a bad request. */
function disabled(): ApiError {
  return new ApiError("AGENT_PROPOSAL_DISABLED", 400, provenanceMessage("AGENT_PROPOSAL_DISABLED"));
}

type Ctx = Parameters<MiddlewareHandler<ApiEnv>>[0];

function headers(c: Ctx): { readonly token?: string; readonly step?: string } {
  const token = c.req.header(PROPOSAL_HEADER);
  const step = c.req.header(PROPOSAL_STEP_HEADER);
  return {
    ...(token === undefined || token === "" ? {} : { token }),
    ...(step === undefined || step === "" ? {} : { step }),
  };
}

/** The path parameters by placeholder name, from the policy row's own template. */
function paramsFor(template: string, path: string): Record<string, string> {
  const want = template.split("/");
  const got = path.split("/");
  const params: Record<string, string> = {};
  for (const [index, segment] of want.entries()) {
    if (!segment.startsWith("{") || !segment.endsWith("}")) continue;
    const value = got[index];
    if (value !== undefined) params[segment.slice(1, -1)] = value;
  }
  return params;
}

// Hono caches the parsed body, so the validator later reads the same copy.
async function body(c: Ctx): Promise<unknown> {
  if (!(c.req.header("content-type") ?? "").includes("application/json")) return undefined;
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

function recordedFrom(
  rows: readonly {
    readonly stepIndex: number;
    readonly detail: string | null;
    readonly confirmedAt: Date;
  }[],
): readonly RecordedStep[] {
  return rows.map((row) => ({
    stepIndex: row.stepIndex,
    detail: row.detail,
    confirmedAt: row.confirmedAt,
  }));
}

export function agentProvenance(deps: Deps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const { token, step } = headers(c);
    if (token === undefined && step === undefined) {
      await next();
      return;
    }
    if (token === undefined || step === undefined) throw refusal("AGENT_PROPOSAL_MALFORMED");

    const principal = c.get("adminPrincipal");
    // Unreachable behind the session gate, but a refusal rather than an assertion: the
    // mounted order is `registrars.ts`'s and not visible from here.
    if (principal === undefined) {
      throw new ApiError("unauthorized", 401, "Admin authentication required");
    }

    const path = new URL(c.req.url).pathname;
    const policy = policyForRequest(c.req.method, path);
    // No row means no declared environment source, so there is nothing to check a step
    // against. A route outside the action registry is the same refusal.
    if (policy === undefined) throw refusal("AGENT_PROPOSAL_ROUTE");
    if (actionKindForRoute(c.req.method, policy.path) === undefined) {
      throw refusal("AGENT_PROPOSAL_ROUTE");
    }

    // The environment the request is **performed in**, from the policy row's own source:
    // the grant check resolved it already, and a row that names none acts in the
    // switcher's. A `targets` row resolves to none here and is refused rather than guessed.
    const grant = c.get("grantContext");
    const switcher = deps.databases.forRequest(c.get("requestEnvironment")).environment;
    const environment =
      policy.environmentFrom === "targets" ? undefined : (grant?.environment ?? switcher);
    if (environment === undefined) throw refusal("AGENT_PROPOSAL_ENVIRONMENT");

    const facts: ActionRequestFacts = {
      path: policy.path,
      method: c.req.method,
      params: paramsFor(policy.path, path),
      body: await body(c),
      environment,
    };

    const proposalId = unverifiedProposalId(token);
    const rows =
      proposalId === undefined ? [] : await listProposalSteps(deps.databases.control, proposalId);

    const result = await checkProvenance({
      token,
      rawStep: step,
      appKey: deps.config.keys.app,
      subject: principal.userId,
      facts,
      recorded: recordedFrom(rows),
      // The deployment's own clock, which is also the clock the handlers stamp
      // `confirmed-at` with: two clocks would put the run window and the rows it is
      // measured from on different time.
      now: deps.clock.now(),
    });
    if (!result.ok) {
      deps.logger.warn("agent proposal refused", { reason: result.code, kind: facts.path });
      throw refusal(result.code);
    }

    c.set("agentProposal", result.proposal);
    await next();
  };
}

/** The refusal a deployment that mints no token owes a request that presents one. */
export function agentProvenanceDisabled(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const { token, step } = headers(c);
    if (token !== undefined || step !== undefined) throw disabled();
    await next();
  };
}

/**
 * Mounted after the grant check, so provenance is read from a request the route policy has
 * already authorised. The real check exists only when the flag is on; with the flag off a
 * request carrying the header is a `400`.
 */
export const registerAgentProvenance: SliceRegistrar = (group, deps) => {
  group.use(
    "*",
    deps.config.flags.agentAuthoring === "none" ? agentProvenanceDisabled() : agentProvenance(deps),
  );
};

export type { VerifiedProposal };
