/**
 * The edit route kind as the admin group mounts it: after the grant check, so an edit token is authorised by
 * exactly the policy an ordinary draft save is, and adds an audit row and never a right. The draft-state half
 * of the check runs inside the save's own transaction, in the forms handler.
 */

import type { MiddlewareHandler } from "hono";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { policyForRequest } from "../membership/route-policy.js";
import {
  EDIT_REFUSAL_CODES,
  EDITS_PER_TURN,
  verifyEditToken,
  type AgentEditPayload,
  type EditRefusalCode,
} from "./edit-token.js";
import { PROPOSAL_HEADER, PROPOSAL_STEP_HEADER } from "./provenance.js";

export const EDIT_HEADER = "x-qcms-agent-edit";

/** The one route an edit or an Undo may name (Q22): never a library write. */
export const EDIT_ROUTE = { method: "PUT", path: "/admin/forms/{id}/draft" } as const;

export type VerifiedEdit = AgentEditPayload;

const STATUS: Readonly<Record<EditRefusalCode, 400 | 403 | 409 | 422>> = {
  AGENT_EDIT_DISABLED: 400,
  AGENT_EDIT_MALFORMED: 403,
  AGENT_EDIT_SIGNATURE: 403,
  AGENT_EDIT_SUBJECT: 403,
  AGENT_EDIT_FORM: 403,
  AGENT_EDIT_EXPIRED: 403,
  AGENT_EDIT_ROUTE: 403,
  AGENT_EDIT_CAP: 403,
  AGENT_EDIT_REPLAYED: 403,
  AGENT_EDIT_REVISION: 409,
  AGENT_EDIT_OP: 422,
  AGENT_EDIT_MISMATCH: 422,
  AGENT_UNDO_SUPERSEDED: 409,
  AGENT_UNDO_MISMATCH: 422,
};

function message(code: EditRefusalCode): string {
  switch (code) {
    case "AGENT_EDIT_DISABLED":
      return "This deployment does not run the assistant, so it records no agent edits.";
    case "AGENT_EDIT_EXPIRED":
      return "That edit is more than ten minutes old. Ask the assistant again.";
    case "AGENT_EDIT_REVISION":
      return "This form's saved draft has changed since that edit was proposed. Ask the assistant again.";
    case "AGENT_UNDO_SUPERSEDED":
      return "That edit has been changed since, so it can no longer be undone on its own.";
    case "AGENT_UNDO_MISMATCH":
      return "An Undo must restore the draft exactly as it stood before that edit.";
    case "AGENT_EDIT_OP":
      return "That save changes more than the edit it carries a token for.";
    case "AGENT_EDIT_MISMATCH":
      return "That save is not the draft the assistant's edit produced.";
    default:
      return "That edit token does not authorise this request.";
  }
}

export function editRefusal(code: EditRefusalCode): ApiError {
  return new ApiError(code, STATUS[code], message(code));
}

function formIdIn(path: string): string | undefined {
  const match = /^\/admin\/forms\/([^/]+)\/draft$/u.exec(path);
  return match?.[1];
}

/** Logs an edit refusal thrown inside the save's transaction, and passes anything else by. */
export function logIfEditRefusal(deps: Deps, error: unknown): void {
  if (error instanceof ApiError && (EDIT_REFUSAL_CODES as readonly string[]).includes(error.code)) {
    logEditRefusal(deps, error.code as EditRefusalCode);
  }
}

/** The code alone is logged: a token's fields are request-chosen. */
export function logEditRefusal(deps: Deps, code: EditRefusalCode): void {
  deps.logger.warn("agent edit refused", { code });
}

export function agentEditProvenance(deps: Deps): MiddlewareHandler<ApiEnv> {
  const refuse = (code: EditRefusalCode): ApiError => {
    logEditRefusal(deps, code);
    return editRefusal(code);
  };
  return async (c, next) => {
    const token = c.req.header(EDIT_HEADER);
    if (token === undefined || token === "") {
      await next();
      return;
    }
    // One request is one kind of agent act: a card's step or a card-less edit, never both.
    if (
      (c.req.header(PROPOSAL_HEADER) ?? "") !== "" ||
      (c.req.header(PROPOSAL_STEP_HEADER) ?? "") !== ""
    ) {
      throw refuse("AGENT_EDIT_MALFORMED");
    }
    const principal = c.get("adminPrincipal");
    if (principal === undefined) {
      throw new ApiError("unauthorized", 401, "Admin authentication required");
    }

    const path = new URL(c.req.url).pathname;
    const policy = policyForRequest(c.req.method, path);
    if (policy?.method !== EDIT_ROUTE.method || policy.path !== EDIT_ROUTE.path) {
      throw refuse("AGENT_EDIT_ROUTE");
    }

    const verified = await verifyEditToken(deps.config.keys.app, token, deps.clock.now());
    if (!verified.ok) throw refuse(verified.code);
    const payload = verified.payload;
    if (payload.sub !== principal.userId) throw refuse("AGENT_EDIT_SUBJECT");
    if (payload.formId !== formIdIn(path)) throw refuse("AGENT_EDIT_FORM");
    if (payload.n >= EDITS_PER_TURN) throw refuse("AGENT_EDIT_CAP");

    c.set("agentEdit", payload);
    await next();
  };
}

/** With the flag off this deployment mints no edit token, so one presented here is a bad request. */
export function agentEditDisabled(deps: Deps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if ((c.req.header(EDIT_HEADER) ?? "") !== "") {
      logEditRefusal(deps, "AGENT_EDIT_DISABLED");
      throw editRefusal("AGENT_EDIT_DISABLED");
    }
    await next();
  };
}
