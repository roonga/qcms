import { t } from "../i18n/en.ts";

import type { Account, SiteActApproval } from "./accounts.ts";

export const SITE_ADMINISTRATORS_PATH = "/site/administrators";
export const PROMOTE_SEARCH_MAX_LENGTH = 200;
/** The most accounts one promote search offers; a narrower search finds the rest. */
export const PROMOTE_CANDIDATE_LIMIT = 10;

export type RoleAct = "promote" | "demote";

export type RoleBlock = "lastSiteAdministrator" | "unclaimed" | "disabled";

/** One promote or demote control: whether it is refused here, and how the act would settle. */
export interface RoleControl {
  readonly blocked?: RoleBlock;
  readonly approval: Exclude<SiteActApproval, "none">;
}

/** Active, claimed Site administrators, the viewer among them, which is the count every guard reads. */
export interface RoleViewer {
  readonly userId: string;
  readonly activeSiteAdministrators: number;
}

/** A promotion applies on step-up alone while the viewer is the only Site administrator. */
export function promoteControl(account: Account, viewer: RoleViewer): RoleControl {
  const approval = viewer.activeSiteAdministrators > 1 ? "needsApprover" : "stepUpAlone";
  if (account.status === "unclaimed") return { blocked: "unclaimed", approval };
  if (account.status === "disabled") return { blocked: "disabled", approval };
  return { approval };
}

/**
 * A demotion waits for a Site administrator other than the viewer and the target; with
 * nobody else it applies on step-up alone, and the last one is never demoted.
 */
export function demoteControl(account: Account, viewer: RoleViewer): RoleControl {
  const targetCounts = account.status === "active" && account.userId !== viewer.userId;
  const others = viewer.activeSiteAdministrators - 1 - (targetCounts ? 1 : 0);
  const approval = others > 0 ? "needsApprover" : "stepUpAlone";
  const last = account.status === "active" && viewer.activeSiteAdministrators <= 1;
  return last ? { blocked: "lastSiteAdministrator", approval } : { approval };
}

export function roleBlockText(block: RoleBlock, name: string): string {
  if (block === "lastSiteAdministrator") {
    return t("site.administrators.blocked.last", { person: name });
  }
  if (block === "unclaimed") return t("site.administrators.blocked.unclaimed");
  return t("site.administrators.blocked.disabled");
}

/** The step-up dialog's line on how the act settles, before it is sent. */
export function roleApprovalText(approval: RoleControl["approval"]): string {
  return approval === "needsApprover" ? t("site.stepUp.needsApprover") : t("site.stepUp.alone");
}

export interface PromoteSearch {
  readonly search: string;
}

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

export function readPromoteSearch(params: SearchParams): PromoteSearch {
  const raw = params["q"];
  const value = (typeof raw === "string" ? raw : raw?.[0]) ?? "";
  return { search: value.trim().slice(0, PROMOTE_SEARCH_MAX_LENGTH) };
}

/** The accounts a promote search offers: every match that is not already a Site administrator. */
export function promoteCandidates(accounts: readonly Account[]): readonly Account[] {
  return accounts.filter((account) => !account.siteAdministrator).slice(0, PROMOTE_CANDIDATE_LIMIT);
}

export type RoleActState =
  | { readonly status: "idle" }
  | { readonly status: "done" | "held"; readonly message: string }
  | { readonly status: "error"; readonly message: string; readonly code: string };

export const IDLE_ROLE_ACT: RoleActState = { status: "idle" };
