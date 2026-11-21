import { t, tPlural } from "../i18n/en.ts";
import { APPROVAL_STATUSES, type ApprovalStatus } from "../membership/types.ts";

/** A draft publish to `prod` the API holds for another holder of Publish forms there. */
export interface HeldPublishRequest {
  readonly requestId: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly status: ApprovalStatus;
  /** False once the draft was saved after the request, which the API then refuses to apply. */
  readonly draftUnchanged: boolean;
}

export type HeldPublishBlock = "changed" | "expired";

/** What one viewer is shown of one pending request. */
export interface HeldPublishView {
  readonly requestId: string;
  /** The viewer asked: pending, and never an Approve. */
  readonly own: boolean;
  /** The viewer holds Publish forms in `prod` and did not ask, so the decision is theirs. */
  readonly decides: boolean;
  /** Why Approve is refused before it is pressed. */
  readonly block: HeldPublishBlock | undefined;
  readonly expiresInDays: number;
  readonly requestedAt: string;
}

const DAY = 86_400_000;

function readStatus(value: unknown): ApprovalStatus | undefined {
  return APPROVAL_STATUSES.find((status) => status === value);
}

/** The API's list, dropping a row it could not have sent. */
export function parseHeldPublishes(value: unknown): readonly HeldPublishRequest[] {
  const rows = (value as { requests?: unknown } | undefined)?.requests;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((entry) => {
    const row = entry as Record<string, unknown>;
    const status = readStatus(row["status"]);
    if (
      typeof row["requestId"] !== "string" ||
      typeof row["requestedBy"] !== "string" ||
      typeof row["requestedAt"] !== "string" ||
      typeof row["expiresAt"] !== "string" ||
      status === undefined
    ) {
      return [];
    }
    return [
      {
        requestId: row["requestId"],
        requestedBy: row["requestedBy"],
        requestedAt: row["requestedAt"],
        expiresAt: row["expiresAt"],
        status,
        draftUnchanged: row["draftUnchanged"] === true,
      },
    ];
  });
}

function blockOf(expired: boolean, draftUnchanged: boolean): HeldPublishBlock | undefined {
  if (expired) return "expired";
  return draftUnchanged ? undefined : "changed";
}

/**
 * The pending requests as one viewer sees them. `canApprove` is whether the viewer holds
 * Publish forms in `prod`; the API still decides the approval itself.
 */
export function heldPublishViews(
  requests: readonly HeldPublishRequest[],
  input: { readonly viewerId: string; readonly canApprove: boolean; readonly now: number },
): readonly HeldPublishView[] {
  return requests
    .filter((request) => request.status === "pending")
    .map((request) => {
      const remaining = Date.parse(request.expiresAt) - input.now;
      const own = request.requestedBy === input.viewerId;
      const expired = Number.isNaN(remaining) || remaining <= 0;
      return {
        requestId: request.requestId,
        own,
        decides: !own && input.canApprove,
        block: blockOf(expired, request.draftUnchanged),
        expiresInDays: expired ? 0 : Math.floor(remaining / DAY),
        requestedAt: request.requestedAt,
      };
    });
}

export function expirySentence(days: number): string {
  if (days <= 0) return t("forms.publish.held.expiresToday");
  return tPlural("forms.publish.held.expiresIn.one", "forms.publish.held.expiresIn.other", days);
}

export function blockSentence(block: HeldPublishBlock): string {
  return block === "expired"
    ? t("forms.publish.requests.expired")
    : t("forms.publish.requests.changed");
}

/** The result of deciding a held publish, as the panel renders it. */
export type HeldDecisionState =
  | { readonly status: "idle" }
  | { readonly status: "approved"; readonly version: number | undefined }
  | { readonly status: "rejected" }
  | { readonly status: "error"; readonly message: string };

/** The refusal the approver reads, in the screen's own words where the code has one. */
export function heldDecisionRefusal(code: string, message: string, environment: string): string {
  switch (code) {
    case "DRAFT_CHANGED_SINCE_REQUEST":
    case "STALE_REVIEW":
      return t("forms.publish.requests.changed");
    case "REQUEST_EXPIRED":
      return t("forms.publish.requests.expired");
    case "OWN_REQUEST":
      return t("forms.publish.requests.own", { environment });
    case "REQUESTER_CANNOT_PUBLISH":
      return t("forms.publish.requests.requesterCannot", { environment });
    case "PUBLISH_FORM_LEFT_WORKSPACE":
      return t("forms.publish.requests.leftWorkspace");
    case "REQUEST_NOT_PENDING":
      return t("forms.publish.requests.decided");
    default:
      return t("forms.publish.requests.failed", { message });
  }
}
