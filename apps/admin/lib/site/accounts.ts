import { formatList } from "../i18n/format.ts";
import { environmentLabel } from "../environment.ts";
import { t, type MessageKey } from "../i18n/en.ts";
import { isEnvironmentRole } from "../membership/access-patterns.ts";

export const SITE_PATH = "/site";
export const ACCOUNTS_PATH = "/site/accounts";
export const NEW_ACCOUNT_PATH = "/site/accounts/new";
export const ACCOUNTS_PAGE_SIZE = 25;
export const ACCOUNT_SEARCH_MAX_LENGTH = 200;

export const ACCOUNT_STATUSES = ["active", "unclaimed", "disabled"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface Account {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly siteAdministrator: boolean;
  readonly status: AccountStatus;
}

export interface AccountPage {
  readonly accounts: readonly Account[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface HeldGroup {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly roles: readonly string[];
  readonly environments: readonly string[];
  readonly suspended: boolean;
}

export interface AccountHoldings {
  readonly groups: readonly HeldGroup[];
  readonly administratorOf: readonly {
    readonly workspaceId: string;
    readonly workspaceName: string;
    readonly last: boolean;
  }[];
}

export function accountHref(userId: string): string {
  return `${ACCOUNTS_PATH}/${encodeURIComponent(userId)}`;
}

export function parseAccountStatus(value: unknown): AccountStatus {
  return ACCOUNT_STATUSES.find((status) => status === value) ?? "disabled";
}

export interface AccountFilters {
  readonly search: string;
  readonly status: AccountStatus | undefined;
  readonly siteAdministrators: boolean;
  readonly page: number;
  readonly activeCount: number;
}

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(value: string | readonly string[] | undefined): string {
  return (typeof value === "string" ? value : value?.[0]) ?? "";
}

/** The directory filters a query string asks for; a value the screen does not offer is dropped. */
export function readAccountFilters(params: SearchParams): AccountFilters {
  const search = first(params["q"]).trim().slice(0, ACCOUNT_SEARCH_MAX_LENGTH);
  const status = ACCOUNT_STATUSES.find((entry) => entry === first(params["status"]));
  const siteAdministrators = first(params["role"]) === "site-administrator";
  const requested = Number(first(params["page"]));
  const page = Number.isInteger(requested) && requested >= 1 && requested <= 10_000 ? requested : 1;
  const activeCount = [search !== "", status !== undefined, siteAdministrators].filter(
    Boolean,
  ).length;
  return { search, status, siteAdministrators, page, activeCount };
}

function filterParams(filters: AccountFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search !== "") params.set("q", filters.search);
  if (filters.status !== undefined) params.set("status", filters.status);
  if (filters.siteAdministrators) params.set("role", "site-administrator");
  return params;
}

/** The API query for one page of the directory. */
export function accountDirectoryQuery(filters: AccountFilters): string {
  const params = filterParams(filters);
  params.set("page", String(filters.page));
  params.set("pageSize", String(ACCOUNTS_PAGE_SIZE));
  return `?${params.toString()}`;
}

/** The list screen's address for a page, keeping the filters. */
export function accountsPageHref(filters: AccountFilters, page: number): string {
  const params = filterParams(filters);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? ACCOUNTS_PATH : `${ACCOUNTS_PATH}?${query}`;
}

export type BlockedReason = "lastSiteAdministrator" | "ownAccount";

export type ControlState =
  { readonly shown: false } | { readonly shown: true; readonly blocked?: BlockedReason };

const HIDDEN: ControlState = { shown: false };

/** How a Site administrator act on another Site administrator is settled. */
export type SiteActApproval = "none" | "stepUpAlone" | "needsApprover";

export interface AccountControls {
  readonly resend: boolean;
  readonly reset: ControlState;
  readonly disable: ControlState;
  readonly reactivate: boolean;
  /** Disable and reset of a Site administrator take a step-up first. */
  readonly stepUp: boolean;
  readonly approval: SiteActApproval;
}

/**
 * Which acts the account page offers. `activeSiteAdministrators` counts active, claimed
 * Site administrators, the viewer among them.
 */
export function accountControls(
  account: Account,
  viewer: { readonly userId: string; readonly activeSiteAdministrators: number },
): AccountControls {
  const own = account.userId === viewer.userId;
  const last =
    account.siteAdministrator &&
    account.status === "active" &&
    viewer.activeSiteAdministrators <= 1;
  let blocked: BlockedReason | undefined;
  if (last) blocked = "lastSiteAdministrator";
  else if (own) blocked = "ownAccount";
  const offered = (shown: boolean): ControlState => {
    if (!shown) return HIDDEN;
    return blocked === undefined ? { shown } : { shown, blocked };
  };

  const targetCounts = account.status === "active" && !own;
  const approvers = viewer.activeSiteAdministrators - 1 - (targetCounts ? 1 : 0);
  let approval: SiteActApproval = "none";
  if (account.siteAdministrator) approval = approvers > 0 ? "needsApprover" : "stepUpAlone";

  return {
    resend: account.status === "unclaimed",
    reset: offered(account.status === "active"),
    disable: offered(account.status !== "disabled"),
    reactivate: account.status === "disabled",
    stepUp: account.siteAdministrator,
    approval,
  };
}

export interface WorkspaceHolding {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly administrator: boolean;
  readonly lastAdministrator: boolean;
  readonly groups: readonly HeldGroup[];
}

/** The account's holdings by workspace, in name order. */
export function holdingsByWorkspace(holdings: AccountHoldings): readonly WorkspaceHolding[] {
  const byId = new Map<string, WorkspaceHolding>();
  const entry = (workspaceId: string, workspaceName: string): WorkspaceHolding =>
    byId.get(workspaceId) ?? {
      workspaceId,
      workspaceName,
      administrator: false,
      lastAdministrator: false,
      groups: [],
    };
  for (const admin of holdings.administratorOf) {
    byId.set(admin.workspaceId, {
      ...entry(admin.workspaceId, admin.workspaceName),
      administrator: true,
      lastAdministrator: admin.last,
    });
  }
  for (const group of holdings.groups) {
    const current = entry(group.workspaceId, group.workspaceName);
    byId.set(group.workspaceId, { ...current, groups: [...current.groups, group] });
  }
  return [...byId.values()].sort((left, right) =>
    left.workspaceName.localeCompare(right.workspaceName, "en"),
  );
}

/** "Publishers (prod)": a group named with the environments its environment roles apply in. */
export function heldGroupLabel(group: HeldGroup, locale: string): string {
  const scoped = group.roles.some(isEnvironmentRole) && group.environments.length > 0;
  return scoped
    ? t("site.accounts.holds.groupIn", {
        group: group.groupName,
        environments: formatList(group.environments.map(environmentLabel), locale),
      })
    : group.groupName;
}

/** The workspaces where disabling leaves no active Workspace administrator. */
export function lastAdministratorWorkspaces(holdings: AccountHoldings): readonly string[] {
  return holdings.administratorOf
    .filter((entry) => entry.last)
    .map((entry) => entry.workspaceName)
    .sort((left, right) => left.localeCompare(right, "en"));
}

const ACCOUNT_ERRORS: Readonly<Record<string, MessageKey>> = {
  MAIL_NOT_CONFIGURED: "site.accounts.error.mailNotConfigured",
  ACCOUNT_EXISTS: "site.accounts.error.exists",
  ACCOUNT_NOT_FOUND: "site.accounts.error.notFound",
  ACCOUNT_BUSY: "site.accounts.error.busy",
  OWN_ACCOUNT: "site.accounts.error.ownAccount",
  ACCOUNT_DISABLED: "site.accounts.error.disabled",
  ACCOUNT_NOT_DISABLED: "site.accounts.error.notDisabled",
  ACCOUNT_UNCLAIMED: "site.accounts.error.unclaimed",
  ACCOUNT_CLAIMED: "site.accounts.error.claimed",
  LAST_SITE_ADMINISTRATOR: "site.accounts.error.lastSiteAdministrator",
  STEP_UP_REQUIRED: "site.accounts.error.stepUpRequired",
  STEP_UP_FAILED: "site.accounts.error.stepUpFailed",
  STEP_UP_LOCKED: "site.accounts.error.stepUpLocked",
  REQUEST_PENDING: "site.accounts.error.requestPending",
  SITE_ADMINISTRATORS_BUSY: "site.accounts.error.busy",
  SITE_ADMINISTRATORS_CHANGED: "site.accounts.error.siteAdministratorsChanged",
  http_400: "site.accounts.error.invalid",
  http_403: "site.accounts.error.forbidden",
};

/** Catalog copy for an account refusal; never the API's own prose. */
export function accountErrorMessage(code: string): string {
  return t(ACCOUNT_ERRORS[code] ?? "site.accounts.error.other");
}

const CREATE_ERRORS: Readonly<Record<string, MessageKey>> = {
  MAIL_NOT_CONFIGURED: "site.accounts.create.mailNotConfigured",
  ACCOUNT_EXISTS: "site.accounts.error.exists",
};

/** Catalog copy for a refused account create; falls back to the shared refusal copy. */
export function createAccountErrorMessage(code: string): string {
  const key = CREATE_ERRORS[code];
  return key === undefined ? accountErrorMessage(code) : t(key);
}

export type AccountActState =
  | { readonly status: "idle" }
  | { readonly status: "done"; readonly message: string }
  | { readonly status: "held"; readonly message: string }
  | { readonly status: "error"; readonly message: string; readonly code: string };

export const IDLE_ACT: AccountActState = { status: "idle" };

export type CreateAccountState =
  | { readonly status: "idle" }
  | {
      readonly status: "sent" | "undeliverable";
      readonly userId: string;
      readonly email: string;
      readonly name: string;
    }
  | {
      readonly status: "error";
      readonly message: string;
      readonly code: string;
      readonly submitted: { readonly email: string; readonly name: string };
    };

export const IDLE_CREATE: CreateAccountState = { status: "idle" };

export type ResetChoice = "password" | "factor";
