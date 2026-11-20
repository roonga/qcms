/**
 * The words a site audit row is read in. The table stores wire vocabulary: a kind, an act
 * named inside `detail` as `act=...`, and opaque ids. Nothing here changes what is stored.
 */

import { t, type MessageKey } from "../i18n/en.ts";

export const SITE_AUDIT_PATH = "/site/audit";
export const SITE_AUDIT_PAGE_SIZE = 25;

export const SITE_AUDIT_KINDS = ["account", "administrator", "approval", "library", "logo"] as const;
export type SiteAuditKind = (typeof SITE_AUDIT_KINDS)[number];

/** The actor a row names when no person did the act, such as the sweep that expires a request. */
export const SYSTEM_ACTOR = "system";

export interface SiteAuditRow {
  readonly id: string;
  readonly actor: string;
  readonly actorEmail: string | null;
  readonly subject: string | null;
  readonly workspaceId: string | null;
  readonly kind: string;
  readonly occurredAt: string;
  readonly detail: string | null;
}

export interface SiteAuditPage {
  readonly rows: readonly SiteAuditRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface SiteAuditFilters {
  readonly kind: SiteAuditKind | undefined;
  readonly page: number;
  readonly activeCount: number;
}

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(value: string | readonly string[] | undefined): string {
  return (typeof value === "string" ? value : value?.[0]) ?? "";
}

export function readSiteAuditFilters(params: SearchParams): SiteAuditFilters {
  const kind = SITE_AUDIT_KINDS.find((entry) => entry === first(params["kind"]));
  const requested = Number(first(params["page"]));
  const page = Number.isInteger(requested) && requested >= 1 && requested <= 9999 ? requested : 1;
  return { kind, page, activeCount: kind === undefined ? 0 : 1 };
}

export function siteAuditQuery(filters: SiteAuditFilters): string {
  const params = new URLSearchParams({ pageSize: String(SITE_AUDIT_PAGE_SIZE) });
  if (filters.kind !== undefined) params.set("kind", filters.kind);
  if (filters.page > 1) params.set("page", String(filters.page));
  return `?${params.toString()}`;
}

export function siteAuditHref(filters: SiteAuditFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.kind !== undefined) params.set("kind", filters.kind);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? SITE_AUDIT_PATH : `${SITE_AUDIT_PATH}?${query}`;
}

const KIND_LABELS: Readonly<Record<SiteAuditKind, MessageKey>> = {
  account: "site.audit.kind.account",
  administrator: "site.audit.kind.administrator",
  approval: "site.audit.kind.approval",
  library: "site.audit.kind.library",
  logo: "site.audit.kind.logo",
};

export function siteAuditKindLabel(kind: string): string {
  const key = (KIND_LABELS as Readonly<Record<string, MessageKey>>)[kind];
  return key === undefined ? kind : t(key);
}

/** `detail` is space-separated `key=value` pairs; a token without `=` is kept under its own name. */
export function detailFields(detail: string | null): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  for (const token of (detail ?? "").split(" ")) {
    if (token === "") continue;
    const at = token.indexOf("=");
    if (at < 0) fields.set(token, "");
    else fields.set(token.slice(0, at), token.slice(at + 1));
  }
  return fields;
}

const ACCOUNT_ACTS: Readonly<Record<string, MessageKey>> = {
  create: "site.audit.act.create",
  resend: "site.audit.act.resend",
  claim: "site.audit.act.claim",
  disable: "site.audit.act.disable",
  reactivate: "site.audit.act.reactivate",
  "grant-while-unclaimed": "site.audit.act.grantWhileUnclaimed",
};

const RESETS: Readonly<Record<string, MessageKey>> = {
  password: "site.audit.act.resetPassword",
  factor: "site.audit.act.resetFactor",
};

const ROLE_ACTS: Readonly<Record<string, MessageKey>> = {
  promote: "site.audit.act.promote",
  demote: "site.audit.act.demote",
};

const REQUEST_ACTS: Readonly<Record<string, MessageKey>> = {
  request: "site.audit.act.requested",
  approve: "site.audit.act.approved",
  reject: "site.audit.act.rejected",
  expire: "site.audit.act.expired",
};

const REQUEST_KINDS: Readonly<Record<string, MessageKey>> = {
  promote: "site.audit.request.promote",
  demote: "site.audit.request.demote",
  disable: "site.audit.request.disable",
  reset: "site.audit.request.reset",
};

/** What a row records, in words; a row this screen does not recognise reads as its kind. */
export function siteAuditActLabel(row: SiteAuditRow): string {
  const fields = detailFields(row.detail);
  const act = fields.get("act") ?? "";
  if (row.kind === "account") {
    if (act === "reset") {
      const key = RESETS[fields.get("reset") ?? ""];
      return t(key ?? "site.audit.act.reset");
    }
    const key = ACCOUNT_ACTS[act];
    if (key !== undefined) return t(key);
  }
  if (row.kind === "administrator") {
    const key = ROLE_ACTS[act];
    if (key !== undefined) return t(key);
  }
  if (row.kind === "approval") {
    const key = REQUEST_ACTS[act];
    const kind = REQUEST_KINDS[fields.get("kind") ?? ""];
    if (key !== undefined) {
      return t(key, { request: kind === undefined ? (fields.get("kind") ?? "") : t(kind) });
    }
  }
  if (row.kind === "logo" && fields.get("logo") === "takedown") return t("site.audit.act.logoTakedown");
  return siteAuditKindLabel(row.kind);
}

/** The system is named as itself, never as an account or a removed one. */
export function siteAuditActor(row: Pick<SiteAuditRow, "actor" | "actorEmail">): string {
  if (row.actor === SYSTEM_ACTOR) return t("site.audit.system");
  return row.actorEmail ?? t("membership.audit.unknownActor", { actor: row.actor });
}

/** The account a row is about, where it names one, for its person lookup. */
export function siteAuditPeople(rows: readonly SiteAuditRow[]): readonly string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if ((row.kind === "account" || row.kind === "administrator") && row.subject !== null) {
      ids.add(row.subject);
    }
    if (row.kind === "approval") {
      const target = detailFields(row.detail).get("target");
      if (target !== undefined && target !== "") ids.add(target);
    }
  }
  return [...ids];
}

/** What a row's act was on: an account by its address, a workspace by its name. */
export function siteAuditSubject(
  row: SiteAuditRow,
  names: { readonly people: ReadonlyMap<string, string>; readonly workspaces: ReadonlyMap<string, string> },
): string {
  if (row.kind === "logo") return t("membership.audit.empty");
  const id =
    row.kind === "approval" ? detailFields(row.detail).get("target") : (row.subject ?? undefined);
  if (id === undefined || id === "") return t("membership.audit.empty");
  if (row.kind === "library") return names.workspaces.get(id) ?? id;
  return names.people.get(id) ?? t("membership.audit.unknownActor", { actor: id });
}
