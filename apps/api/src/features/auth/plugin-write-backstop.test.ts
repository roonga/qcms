import { EMPTY_MEMBER_ROLE, OWNER_MEMBER_ROLE } from "@roonga/qcms-db";
import { describe, expect, it } from "vitest";

import { refuseMemberAdd } from "./plugin-write-backstop.js";

describe("refuseMemberAdd, shared by beforeAddMember and workspace creation", () => {
  it("admits the Workspace administrator flag and the empty role on an open workspace", () => {
    expect(() => refuseMemberAdd({ role: OWNER_MEMBER_ROLE }, { archivedAt: null })).not.toThrow();
    expect(() => refuseMemberAdd({ role: EMPTY_MEMBER_ROLE }, {})).not.toThrow();
  });

  it("refuses a member row in an archived workspace", () => {
    expect(() => refuseMemberAdd({ role: OWNER_MEMBER_ROLE }, { archivedAt: new Date() })).toThrow(
      /archived/,
    );
  });

  it("refuses any other role, and a missing one", () => {
    expect(() => refuseMemberAdd({ role: "forms.editor" }, { archivedAt: null })).toThrow(
      /not a role a member row carries/,
    );
    expect(() => refuseMemberAdd({}, { archivedAt: null })).toThrow(/needs a role/);
  });
});
