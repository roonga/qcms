import { describe, expect, it } from "vitest";

import {
  AUDIT_FILTER_KIND_LABELS,
  AUDIT_FILTER_KINDS,
  auditActors,
  auditHref,
  matchesAuditPerson,
  readAuditFilters,
} from "./audit-filters.ts";
import type { AuditRow } from "./types.ts";
import { messages } from "../i18n/en.ts";

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "aa_1",
    actor: "usr_1",
    actorEmail: "admin@qcms.test",
    environment: null,
    formId: null,
    kind: "grant",
    occurredAt: "2026-11-20T00:00:00.000Z",
    detail: null,
    ...overrides,
  };
}

describe("the audit filters", () => {
  it("offers every stored kind, each from the catalog", () => {
    expect(AUDIT_FILTER_KINDS).toHaveLength(12);
    for (const kind of AUDIT_FILTER_KINDS) {
      expect(messages).toHaveProperty(AUDIT_FILTER_KIND_LABELS[kind]);
    }
  });

  it("drops a kind the audit does not store rather than sending it to the API", () => {
    expect(readAuditFilters({ kind: "whatever" }).kind).toBeUndefined();
    expect(readAuditFilters({ kind: "approval" }).kind).toBe("approval");
  });

  it("reads the person as typed and counts the filters in use", () => {
    const filters = readAuditFilters({ kind: "setting", person: " admin@qcms.test " });
    expect(filters.person).toBe("admin@qcms.test");
    expect(filters.activeCount).toBe(2);
    expect(readAuditFilters({ person: "   " }).activeCount).toBe(0);
  });

  it("lands on the first page for anything that is not a page number", () => {
    expect(readAuditFilters({}).page).toBe(1);
    expect(readAuditFilters({ page: "0" }).page).toBe(1);
    expect(readAuditFilters({ page: "nope" }).page).toBe(1);
    expect(readAuditFilters({ page: "3" }).page).toBe(3);
  });

  it("names each account once, and narrows to the one chosen", () => {
    const rows = [row(), row({ id: "aa_2" }), row({ id: "aa_3", actorEmail: null })];
    expect(auditActors(rows)).toEqual(["admin@qcms.test", "usr_1"]);
    expect(matchesAuditPerson(rows[0] as AuditRow, "admin@qcms.test")).toBe(true);
    expect(matchesAuditPerson(rows[0] as AuditRow, "someone@qcms.test")).toBe(false);
    expect(matchesAuditPerson(rows[0] as AuditRow, undefined)).toBe(true);
  });

  it("keeps the filters on a paged address, and leaves the first page unmarked", () => {
    const filters = readAuditFilters({ kind: "approval", person: "admin@qcms.test" });
    expect(auditHref("/workspaces/ws_1/audit", filters, { page: 2 })).toBe(
      "/workspaces/ws_1/audit?kind=approval&person=admin%40qcms.test&page=2",
    );
    expect(auditHref("/workspaces/ws_1/audit", readAuditFilters({}))).toBe(
      "/workspaces/ws_1/audit",
    );
  });
});
