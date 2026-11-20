import { describe, expect, it } from "vitest";

import {
  AUDIT_FILTER_KIND_LABELS,
  AUDIT_FILTER_KINDS,
  auditActorChoices,
  auditHref,
  readAuditFilters,
} from "./audit-filters.ts";
import { messages } from "../i18n/en.ts";

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

  it("reads the account as sent and counts the filters in use", () => {
    const filters = readAuditFilters({ kind: "setting", actor: " usr_1 " });
    expect(filters.actor).toBe("usr_1");
    expect(filters.activeCount).toBe(2);
    expect(readAuditFilters({ actor: "   " }).activeCount).toBe(0);
  });

  it("lands on the first page for anything that is not a page number", () => {
    expect(readAuditFilters({}).page).toBe(1);
    expect(readAuditFilters({ page: "0" }).page).toBe(1);
    expect(readAuditFilters({ page: "nope" }).page).toBe(1);
    expect(readAuditFilters({ page: "3" }).page).toBe(3);
  });

  it("offers the audit's accounts by address, and keeps a chosen one it does not list", () => {
    const actors = [
      { actor: "usr_2", actorEmail: "sam@qcms.test" },
      { actor: "usr_9", actorEmail: null },
      { actor: "usr_1", actorEmail: "grace@qcms.test" },
    ];
    expect(auditActorChoices(actors, undefined).map((entry) => entry.actor)).toEqual([
      "usr_1",
      "usr_2",
      "usr_9",
    ]);
    expect(auditActorChoices(actors, "usr_1")).toHaveLength(3);
    expect(auditActorChoices(actors, "usr_7")).toContainEqual({ actor: "usr_7", actorEmail: null });
  });

  it("keeps the filters on a paged address, and leaves the first page unmarked", () => {
    const filters = readAuditFilters({ kind: "approval", actor: "usr_1" });
    expect(auditHref("/workspaces/ws_1/audit", filters, { page: 2 })).toBe(
      "/workspaces/ws_1/audit?kind=approval&actor=usr_1&page=2",
    );
    expect(auditHref("/workspaces/ws_1/audit", readAuditFilters({}))).toBe(
      "/workspaces/ws_1/audit",
    );
  });
});
