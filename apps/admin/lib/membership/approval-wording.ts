/**
 * The words a held request is read in. The API owns the request: its kind, its 7-day window and
 * its status. Nothing here decides anything; it says what each stored value means.
 */

import { t, tPlural, type MessageKey } from "../i18n/en.ts";

import type { ApprovalRequest } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One request as a screen reads it: the stored row, and the days left on its window. */
export interface HeldRequest {
  readonly request: ApprovalRequest;
  readonly expiresInDays: number;
}

/** Days are counted on the server, so a client render cannot disagree with the one it hydrates. */
export function heldRequests(
  requests: readonly ApprovalRequest[],
  now: Date,
): readonly HeldRequest[] {
  return requests.map((request) => {
    const expires = Date.parse(request.expiresAt);
    const days = Number.isNaN(expires) ? 0 : Math.ceil((expires - now.getTime()) / DAY_MS);
    return { request, expiresInDays: Math.max(0, days) };
  });
}

export function expiryWording(expiresInDays: number): string {
  return expiresInDays === 0
    ? t("membership.requests.expiresToday")
    : tPlural(
        "membership.requests.expiresInOne",
        "membership.requests.expiresIn",
        expiresInDays,
      );
}

const ASKED: Readonly<Record<string, MessageKey>> = {
  "second-approval-off": "membership.requests.asked.secondApprovalOff",
  "self-grant": "membership.requests.asked.selfGrant",
  "move-form": "membership.requests.asked.moveForm",
};

/** Who asked for what; a self-grant names the group from the roles and name its request bound. */
export function askedSentence(request: ApprovalRequest, person: string): string {
  const key = ASKED[request.kind];
  if (key === undefined) return t("membership.requests.asked.other", { person });
  const name = request.payload["name"];
  return t(key, {
    person,
    group: typeof name === "string" && name !== "" ? name : t("membership.requests.group"),
  });
}

const DECIDED: Readonly<Record<string, MessageKey>> = {
  approved: "membership.requests.status.approved",
  rejected: "membership.requests.status.rejected",
  expired: "membership.requests.status.expired",
  lapsed: "membership.requests.status.lapsed",
};

/** How a decided request ended; `lapsed` names the approver who tried, because nobody refused it. */
export function decidedSentence(request: ApprovalRequest, person: string): string | undefined {
  const key = DECIDED[request.status];
  return key === undefined ? undefined : t(key, { person });
}

/** An account by the address this workspace knows it by, and by its stored id where it knows none. */
export function personLabel(id: string | null, people: ReadonlyMap<string, string>): string {
  if (id === null) return "";
  return people.get(id) ?? t("membership.requests.unknownPerson", { actor: id });
}

/** The newest request of one kind, which is the only one a settings screen speaks for. */
export function newestOfKind(
  requests: readonly HeldRequest[],
  kind: string,
): HeldRequest | undefined {
  return requests.find((entry) => entry.request.kind === kind);
}
