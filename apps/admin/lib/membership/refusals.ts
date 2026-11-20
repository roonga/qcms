import { t, type MessageKey } from "../i18n/en.ts";

/** The code a write answers with when the API stored it as a request for an Approver. */
export const APPROVAL_REQUESTED = "APPROVAL_REQUESTED";

const SELF_GRANT_REFUSED = "SELF_GRANT_REFUSED";

// Catalog copy for the membership routes' own refusals; anything else keeps the shared reading.
const MEMBERSHIP_CODE_MESSAGES: Readonly<Record<string, MessageKey>> = {
  ACCOUNT_NOT_ADDABLE: "membership.refusal.notAddable",
  LAST_ADMINISTRATOR: "membership.refusal.lastAdministrator",
  RECONFIRM_OWN_REFUSED: "membership.refusal.reconfirmOwn",
  RECONFIRM_BY_PERFORMER_REFUSED: "membership.refusal.reconfirmByPerformer",
  NOT_SUSPENDED: "membership.refusal.notSuspended",
  ACCESS_GROUP_NAME_TAKEN: "membership.refusal.nameTaken",
  ACCESS_GROUP_SCOPE_INVALID: "membership.groups.needsEnvironment",
  ALREADY_GRANTED: "membership.refusal.alreadyGranted",
  ACCOUNT_BUSY: "membership.refusal.accountBusy",
};

export type MembershipOutcome =
  | { readonly kind: "held"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string };

/**
 * A refused write in the screen's words. A held request, and the self-grant refusal that means the
 * same thing until the API stores requests, are a wait for an Approver and never a success.
 */
export function membershipRefusal(result: {
  readonly code: string;
  readonly message: string;
}): MembershipOutcome {
  if (result.code === APPROVAL_REQUESTED) {
    return { kind: "held", message: t("membership.held.requested") };
  }
  if (result.code === SELF_GRANT_REFUSED) {
    return { kind: "held", message: t("membership.held.refused") };
  }
  const key = MEMBERSHIP_CODE_MESSAGES[result.code];
  return { kind: "refused", message: key === undefined ? result.message : t(key) };
}
