import type { MessageKey } from "../i18n/en.ts";

import type { AuditRow } from "./types.ts";

/**
 * The stored kinds the Act filter offers, in the order the audit reads them. The API filters on
 * one stored kind, so the filter is the API's own vocabulary rather than a grouping over it.
 */
export const AUDIT_FILTER_KINDS = [
  "read",
  "export",
  "erasure",
  "grant",
  "revoke",
  "setting",
  "derive",
  "group",
  "administrator",
  "approval",
  "account",
  "link",
] as const;

export type AuditFilterKind = (typeof AUDIT_FILTER_KINDS)[number];

export const AUDIT_PERSON_MAX_LENGTH = 200;

export interface AuditFilters {
  /** Narrows the whole audit, because the API takes it. */
  readonly kind: AuditFilterKind | undefined;
  /** Narrows the rows this page carries: the audit read has no actor parameter. */
  readonly person: string | undefined;
  readonly page: number;
  readonly activeCount: number;
}

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(value: string | readonly string[] | undefined): string {
  return (typeof value === "string" ? value : value?.[0]) ?? "";
}

function isFilterKind(value: string): value is AuditFilterKind {
  return (AUDIT_FILTER_KINDS as readonly string[]).includes(value);
}

/** The filters a query string asks for; a kind the audit does not store is dropped, not sent on. */
export function readAuditFilters(params: SearchParams): AuditFilters {
  const asked = first(params.kind);
  const kind = isFilterKind(asked) ? asked : undefined;
  const typed = first(params.person).trim().slice(0, AUDIT_PERSON_MAX_LENGTH);
  const person = typed === "" ? undefined : typed;
  const requested = Number.parseInt(first(params.page), 10);
  return {
    kind,
    person,
    page: Number.isInteger(requested) && requested > 0 ? requested : 1,
    activeCount: [kind, person].filter((entry) => entry !== undefined).length,
  };
}

/** One account to name in the Person filter: the address where the audit has one, else the stored id. */
export function auditActor(row: AuditRow): string {
  return row.actorEmail ?? row.actor;
}

/** The accounts on this page, each once, so the filter offers only what it can narrow. */
export function auditActors(rows: readonly AuditRow[]): readonly string[] {
  return [...new Set(rows.map(auditActor))].sort((left, right) => left.localeCompare(right));
}

export function matchesAuditPerson(row: AuditRow, person: string | undefined): boolean {
  return person === undefined || auditActor(row) === person;
}

/** This page's address with one filter changed, so Previous and Next keep the filters. */
export function auditHref(
  basePath: string,
  filters: AuditFilters,
  next: { readonly page?: number } = {},
): string {
  const query = new URLSearchParams();
  if (filters.kind !== undefined) query.set("kind", filters.kind);
  if (filters.person !== undefined) query.set("person", filters.person);
  const page = next.page ?? filters.page;
  if (page > 1) query.set("page", String(page));
  return query.size === 0 ? basePath : `${basePath}?${query.toString()}`;
}

export const AUDIT_FILTER_KIND_LABELS: Readonly<Record<AuditFilterKind, MessageKey>> = {
  read: "membership.audit.kind.read",
  export: "membership.audit.kind.export",
  erasure: "membership.audit.kind.erasure",
  grant: "membership.audit.kind.grant",
  revoke: "membership.audit.kind.revoke",
  setting: "membership.audit.kind.setting",
  derive: "membership.audit.kind.derive",
  group: "membership.audit.kind.group",
  administrator: "membership.audit.kind.administrator",
  approval: "membership.audit.kind.approval",
  account: "membership.audit.kind.account",
  link: "membership.audit.kind.link",
};
