import { t, type MessageKey } from "../i18n/en.ts";
import {
  APPROVAL_STATUSES,
  type ApprovalRequest,
  type ApprovalStatus,
} from "../membership/types.ts";

import { accountErrorMessage } from "./accounts.ts";

export const APPROVAL_REQUESTS_PATH = "/site/approval-requests";

export const APPROVAL_SCOPES = ["site", "workspace"] as const;
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];

/** A request as Site configuration reads it: a site request, or one held in a named workspace. */
export interface SiteApprovalRequest extends ApprovalRequest {
  readonly scope: ApprovalScope;
  readonly workspaceId: string | null;
}

export interface SiteApprovalPage {
  readonly requests: readonly SiteApprovalRequest[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** The API's page size for this list. */
export const APPROVAL_PAGE_SIZE = 50;

export interface ApprovalFilters {
  readonly scope: ApprovalScope | undefined;
  readonly status: ApprovalStatus | undefined;
  readonly page: number;
  readonly activeCount: number;
}

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(value: string | readonly string[] | undefined): string {
  return (typeof value === "string" ? value : value?.[0]) ?? "";
}

/** The filters a query string asks for; a value the screen does not offer is dropped. Pending is the default. */
export function readApprovalFilters(params: SearchParams): ApprovalFilters {
  const scope = APPROVAL_SCOPES.find((entry) => entry === first(params["scope"]));
  const rawStatus = first(params["status"]);
  const status =
    rawStatus === "all" ? undefined : (APPROVAL_STATUSES.find((s) => s === rawStatus) ?? "pending");
  const requested = Number(first(params["page"]));
  const page = Number.isInteger(requested) && requested >= 1 && requested <= 9999 ? requested : 1;
  const activeCount = [scope !== undefined, status !== "pending"].filter(Boolean).length;
  return { scope, status, page, activeCount };
}

function filterParams(filters: ApprovalFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.scope !== undefined) params.set("scope", filters.scope);
  if (filters.status !== "pending") params.set("status", filters.status ?? "all");
  return params;
}

/** The API's query for these filters; "all" is no status at all. */
export function approvalRequestsQuery(filters: ApprovalFilters): string {
  const params = new URLSearchParams();
  if (filters.scope !== undefined) params.set("scope", filters.scope);
  if (filters.status !== undefined) params.set("status", filters.status);
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export function approvalRequestsHref(filters: ApprovalFilters, page: number): string {
  const params = filterParams(filters);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? APPROVAL_REQUESTS_PATH : `${APPROVAL_REQUESTS_PATH}?${query}`;
}

export type DecisionBlock = "ownRequest" | "target" | "expired";

export type DecisionControl =
  | { readonly kind: "decide"; readonly stepUp: boolean }
  | { readonly kind: "blocked"; readonly reason: DecisionBlock }
  | { readonly kind: "decided" };

/**
 * Whether the viewer may decide a request here. A site request needs a step-up to approve.
 * The window is the API's to judge on its own clock, so a pending row is never called
 * expired here; the API refuses the requester, the target and a closed window regardless.
 */
export function decisionControl(request: SiteApprovalRequest, viewerId: string): DecisionControl {
  if (request.status !== "pending") return { kind: "decided" };
  if (request.requestedBy === viewerId) return { kind: "blocked", reason: "ownRequest" };
  if (request.scope === "site" && request.target === viewerId) {
    return { kind: "blocked", reason: "target" };
  }
  return { kind: "decide", stepUp: request.scope === "site" };
}

const BLOCKED: Readonly<Record<DecisionBlock, MessageKey>> = {
  ownRequest: "site.requests.blocked.own",
  target: "site.requests.blocked.target",
  expired: "site.requests.blocked.expired",
};

/** `expiredOn` is the request's last day, formatted in the operator's own zone. */
export function decisionBlockText(reason: DecisionBlock, expiredOn: string): string {
  return t(BLOCKED[reason], { date: expiredOn });
}

/** The names a request's own ids resolve through. */
export interface RequestNames {
  readonly person: (id: string) => string;
  readonly workspace: (id: string | null) => string;
}

const ASKED: Readonly<Record<string, MessageKey>> = {
  promote: "site.requests.asked.promote",
  demote: "site.requests.asked.demote",
  disable: "site.requests.asked.disable",
  reset: "site.requests.asked.reset",
  "second-approval-off": "site.requests.asked.secondApprovalOff",
  "self-grant": "site.requests.asked.selfGrant",
  "move-form": "site.requests.asked.moveForm",
};

/** Who asked for what, with the account or workspace it is about. */
export function requestSentence(request: SiteApprovalRequest, names: RequestNames): string {
  const person = names.person(request.requestedBy);
  const key = ASKED[request.kind];
  if (key === undefined) return t("membership.requests.asked.other", { person });
  const group = request.payload["name"];
  return t(key, {
    person,
    target: request.scope === "site" ? names.person(request.target) : "",
    workspace: names.workspace(request.workspaceId),
    group: typeof group === "string" && group !== "" ? group : t("membership.requests.group"),
  });
}

const STATUS_LABELS: Readonly<Record<ApprovalStatus, MessageKey>> = {
  pending: "site.requests.status.pending",
  approved: "site.requests.status.approved",
  rejected: "site.requests.status.rejected",
  expired: "site.requests.status.expired",
  lapsed: "site.requests.status.lapsed",
};

export function approvalStatusLabel(status: ApprovalStatus): string {
  return t(STATUS_LABELS[status]);
}

const DECISION_ERRORS: Readonly<Record<string, MessageKey>> = {
  OWN_REQUEST: "site.requests.blocked.own",
  TARGET_DECIDES: "site.requests.blocked.target",
  REQUEST_EXPIRED: "site.requests.error.expired",
  REQUEST_NOT_PENDING: "site.requests.error.decided",
  REQUEST_NOT_FOUND: "site.requests.error.notFound",
  APPROVER_NOT_SITE_ADMINISTRATOR: "site.accounts.error.forbidden",
};

/** Catalog copy for a refused decision; falls back to the shared account refusals. */
export function decisionErrorMessage(code: string): string {
  const key = DECISION_ERRORS[code];
  return key === undefined ? accountErrorMessage(code) : t(key, { date: "" });
}
