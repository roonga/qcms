import { describe, expect, it } from "vitest";

import {
  ACTIONS,
  EMPTY_ROLE_NAMES,
  PRODUCTION_ENVIRONMENT,
  RESOURCES,
  ROLE_NAMES,
  type Action,
  type Resource,
  type RoleName,
  decideAccess,
  holdsStatement,
  isEnvironmentScoped,
  isFormScoped,
  roles,
  rolesHolding,
} from "./policy.js";

/**
 * The permissions matrix, walked row by row (task 069's criteria 1 to 6).
 *
 * The matrix in section 6 of `plan/environments-and-workspaces.md` is this task's
 * specification, so the table below is that table as data and the cases walk it in both
 * directions: every role against every action, rather than each role against its own
 * actions. **A right that leaks across the two families fails a test here rather than a
 * review** (criterion 1).
 *
 * This file is the statement-and-scope half, which is pure. The HTTP half - that a
 * refusal is a 403 with no payload, from a real route, under a real session - is
 * `apps/api/e2e/security/01-authorization-matrix.e2e.ts`, and the two are deliberately
 * separate: a pure function can be walked exhaustively and an e2e suite cannot.
 */

/** Every grant in the installation, as the scope that makes the role's own rows reachable. */
const WHOLE_SCOPE = { environments: ["all"], forms: ["all"] } as const;

/** One role, held with the whole of both scopes. The widest a grant can be. */
function holding(role: RoleName): Parameters<typeof decideAccess>[0]["grants"] {
  return [{ role, ...WHOLE_SCOPE }];
}

/** Ask one question of one role. */
function allows(
  role: RoleName,
  resource: Resource,
  action: string,
  options: { readonly environment?: string; readonly formId?: string } = {},
): boolean {
  return decideAccess({
    memberRole: undefined,
    grants: holding(role),
    request: { resource, action, ...options },
  }).allowed;
}

/**
 * The matrix as data: for each (resource, action), the roles that hold it.
 *
 * Written out rather than derived from `rolesHolding`, which would make the assertion
 * compare the statements against themselves. Every row below is a row of the permissions
 * matrix, and the empty arrays are the cells that are empty there.
 */
const MATRIX: readonly {
  readonly resource: Resource;
  readonly action: Action;
  readonly roles: readonly RoleName[];
}[] = [
  // "See drafts, published versions and release history" - the first read row.
  {
    resource: "question",
    action: "read",
    roles: ["forms.viewer", "forms.editor", "forms.approver"],
  },
  { resource: "form", action: "read", roles: ["forms.viewer", "forms.editor", "forms.approver"] },
  {
    resource: "release",
    action: "read",
    roles: ["forms.viewer", "forms.editor", "forms.approver"],
  },
  // "See link and endpoint configuration" - the second read row, in every environment.
  { resource: "link", action: "read", roles: ["forms.viewer", "forms.editor", "forms.approver"] },
  {
    resource: "webhook",
    action: "read",
    roles: ["forms.viewer", "forms.editor", "forms.approver"],
  },
  // "Draft and edit questions and forms, pin shared questions, preview" - editor alone.
  { resource: "question", action: "write", roles: ["forms.editor"] },
  { resource: "form", action: "write", roles: ["forms.editor"] },
  { resource: "form", action: "preview", roles: ["forms.editor"] },
  // "Publish a version (releases nowhere)" - editor alone, and no environment.
  { resource: "form", action: "publish", roles: ["forms.editor"] },
  // The environment-scoped writes: editor and approver, split by environment below.
  { resource: "release", action: "create", roles: ["forms.editor", "forms.approver"] },
  { resource: "form", action: "close", roles: ["forms.editor", "forms.approver"] },
  { resource: "link", action: "mint", roles: ["forms.editor", "forms.approver"] },
  { resource: "link", action: "revoke", roles: ["forms.editor", "forms.approver"] },
  { resource: "webhook", action: "configure", roles: ["forms.editor", "forms.approver"] },
  // The data family. Nothing in the authoring family reaches any of it.
  { resource: "response", action: "read", roles: ["responses.viewer"] },
  { resource: "response", action: "export", roles: ["responses.viewer"] },
  { resource: "response", action: "erase", roles: ["responses.eraser"] },
  { resource: "response", action: "dispose", roles: ["responses.eraser"] },
  // The tombstone list: no role at all. Operator state, the claim's, carrying existence
  // without content, so Q29's "the claim reads no response" is intact.
  { resource: "response", action: "history", roles: [] },
  // The owner's four rows, and nobody else's.
  { resource: "membership", action: "read", roles: ["forms.owner"] },
  { resource: "membership", action: "write", roles: ["forms.owner"] },
  { resource: "workspace", action: "read", roles: ["forms.owner"] },
  { resource: "workspace", action: "update", roles: ["forms.owner"] },
  { resource: "workspace", action: "archive", roles: ["forms.owner"] },
  { resource: "audit", action: "read", roles: ["forms.owner"] },
];

describe("the matrix is walked in both directions (criterion 1)", () => {
  it("covers every (resource, action) the policy declares", () => {
    // The floor under every case below: a pair missing from MATRIX would be a pair
    // nothing asserts, which is the failure mode this file exists for.
    const declared = RESOURCES.flatMap((resource) =>
      (ACTIONS[resource] as readonly string[]).map((action) => `${resource}:${action}`),
    );
    const walked = MATRIX.map((row) => `${row.resource}:${row.action}`);
    expect([...declared].sort()).toEqual([...walked].sort());
  });

  it.each(
    MATRIX.flatMap((row) =>
      ROLE_NAMES.map((role) => [`${role} on ${row.resource}:${row.action}`, role, row] as const),
    ),
  )("%s matches the matrix", (_label, role, row) => {
    const expected = row.roles.includes(role);
    // Every environment-scoped pair is asked about `test`, because the production split
    // is a case of its own below: at `prod` an editor is refused a row it holds in
    // `test`, which is the matrix and not a scope.
    const options = isEnvironmentScoped(row.resource, row.action)
      ? {
          environment: "test",
          ...(isFormScoped(row.resource, row.action) ? { formId: "frm_x" } : {}),
        }
      : {};
    expect(allows(role, row.resource, row.action, options)).toBe(expected);
  });

  it("agrees with the statements read back off the roles", () => {
    // The other direction: `rolesHolding` is what the admin's explanation of a role and
    // the section 3.2 extension read, so it has to answer what the table says.
    for (const row of MATRIX) {
      expect([...rolesHolding(row.resource, row.action)].sort()).toEqual([...row.roles].sort());
    }
  });
});

describe("the two families imply nothing about each other (criterion 2, Q27)", () => {
  it("gives a `forms.editor` with `prod` in scope no response in any environment", () => {
    // The probe the work order says to write first. If this passes before the families
    // are built, the resolver is reading a ladder.
    for (const environment of ["dev", "test", "prod"]) {
      for (const action of ["read", "export", "erase"]) {
        expect(
          decideAccess({
            memberRole: undefined,
            grants: [{ role: "forms.editor", environments: ["prod"], forms: ["all"] }],
            request: { resource: "response", action, environment, formId: "frm_x" },
          }).allowed,
          `forms.editor reached response:${action} in ${environment}`,
        ).toBe(false);
      }
    }
  });

  it("gives a `forms.owner` no response read without a `responses.viewer` grant", () => {
    const owner = decideAccess({
      memberRole: "forms.owner",
      grants: [],
      request: { resource: "response", action: "read", environment: "prod", formId: "frm_x" },
    });
    expect(owner.allowed).toBe(false);

    // And the same account with the grant reaches it, so the refusal above is about the
    // family rather than about the request being malformed.
    const withGrant = decideAccess({
      memberRole: "forms.owner",
      grants: [{ role: "responses.viewer", environments: ["prod"], forms: ["all"] }],
      request: { resource: "response", action: "read", environment: "prod", formId: "frm_x" },
    });
    expect(withGrant.allowed).toBe(true);
    expect(withGrant.role).toBe("responses.viewer");
  });

  it("gives a `forms.owner` nothing on a form, release, link, webhook or response", () => {
    // The matrix's `forms.owner` column touches none of those rows at all.
    for (const resource of [
      "form",
      "release",
      "link",
      "webhook",
      "response",
      "question",
    ] as const) {
      for (const action of ACTIONS[resource] as readonly string[]) {
        expect(
          allows("forms.owner", resource, action, { environment: "test", formId: "frm_x" }),
        ).toBe(false);
      }
    }
  });
});

describe("a data role holds no authoring right, and `forms.viewer` holds none at all (criterion 3)", () => {
  it("refuses a `responses.viewer` every authoring act", () => {
    for (const [resource, action] of [
      ["form", "write"],
      ["form", "publish"],
      ["form", "preview"],
      ["release", "create"],
      ["question", "write"],
    ] as const) {
      expect(allows("responses.viewer", resource, action, { environment: "test" })).toBe(false);
    }
  });

  it("refuses a `responses.eraser` a read and an export", () => {
    expect(
      allows("responses.eraser", "response", "read", { environment: "test", formId: "f" }),
    ).toBe(false);
    expect(
      allows("responses.eraser", "response", "export", { environment: "test", formId: "f" }),
    ).toBe(false);
    expect(
      allows("responses.eraser", "response", "erase", { environment: "test", formId: "f" }),
    ).toBe(true);
  });

  it("refuses a `forms.viewer` every write and every response", () => {
    for (const [resource, action] of [
      ["form", "write"],
      ["form", "publish"],
      ["form", "preview"],
      ["form", "close"],
      ["release", "create"],
      ["link", "mint"],
      ["webhook", "configure"],
      ["response", "read"],
    ] as const) {
      expect(
        allows("forms.viewer", resource, action, { environment: "test", formId: "frm_x" }),
      ).toBe(false);
    }
  });
});

describe("the scope narrows both dimensions (criterion 4, Q25 and Q28)", () => {
  it("refuses an environment-scoped act outside the grant's environments", () => {
    const grants = [{ role: "forms.editor" as const, environments: ["test"], forms: ["all"] }];
    const ask = (environment: string): boolean =>
      decideAccess({
        memberRole: undefined,
        grants,
        request: { resource: "link", action: "mint", environment },
      }).allowed;
    expect(ask("test")).toBe(true);
    expect(ask("dev")).toBe(false);
  });

  it("refuses the responses of a form not on a data grant's form list", () => {
    const grants = [
      { role: "responses.viewer" as const, environments: ["prod"], forms: ["frm_claims"] },
    ];
    const ask = (formId: string): boolean =>
      decideAccess({
        memberRole: undefined,
        grants,
        request: { resource: "response", action: "read", environment: "prod", formId },
      }).allowed;
    expect(ask("frm_claims")).toBe(true);
    expect(ask("frm_other")).toBe(false);
  });

  it("refuses an environment-scoped act that names no environment at all", () => {
    // A route that forgot to name its environment is refused rather than served against
    // the whole scope, which is the fail-closed direction: `all` means every environment
    // the grant reaches, not "no environment needed".
    expect(
      decideAccess({
        memberRole: undefined,
        grants: holding("responses.viewer"),
        request: { resource: "response", action: "read", formId: "frm_x" },
      }).allowed,
    ).toBe(false);
  });

  it("reads `all` as the whole of a dimension and nothing less", () => {
    expect(
      allows("responses.viewer", "response", "read", { environment: "dev", formId: "any" }),
    ).toBe(true);
  });
});

describe("the production split is the matrix and not a scope (Q30, Q33)", () => {
  it("refuses a `forms.editor` a production write even with `prod` in scope", () => {
    for (const [resource, action] of [
      ["release", "create"],
      ["form", "close"],
      ["link", "mint"],
      ["link", "revoke"],
      ["webhook", "configure"],
    ] as const) {
      const grants = [{ role: "forms.editor" as const, environments: ["all"], forms: ["all"] }];
      const decision = decideAccess({
        memberRole: undefined,
        grants,
        request: { resource, action, environment: PRODUCTION_ENVIRONMENT },
      });
      expect(decision.allowed, `forms.editor reached ${resource}:${action} in prod`).toBe(false);
    }
  });

  it("allows a `forms.approver` holding `prod`, and refuses one that does not", () => {
    const ask = (environments: readonly string[]): boolean =>
      decideAccess({
        memberRole: undefined,
        grants: [{ role: "forms.approver", environments, forms: ["all"] }],
        request: { resource: "release", action: "create", environment: PRODUCTION_ENVIRONMENT },
      }).allowed;
    expect(ask(["prod"])).toBe(true);
    expect(ask(["all"])).toBe(true);
    expect(ask(["test"])).toBe(false);
  });

  it("leaves the data family unsplit: a `responses.viewer` with `prod` reads prod", () => {
    // The split is about the control plane. A production response read is what a
    // `responses.viewer` grant on `prod` is for, and refusing it would make the grant
    // mean nothing.
    expect(
      decideAccess({
        memberRole: undefined,
        grants: [{ role: "responses.viewer", environments: ["prod"], forms: ["all"] }],
        request: {
          resource: "response",
          action: "read",
          environment: PRODUCTION_ENVIRONMENT,
          formId: "frm_x",
        },
      }).allowed,
    ).toBe(true);
  });
});

describe("a caller with no grant reaches nothing (criterion 5, finding G)", () => {
  it("refuses every act for a caller with no member row and no team", () => {
    for (const row of MATRIX) {
      expect(
        decideAccess({
          memberRole: undefined,
          grants: [],
          request: {
            resource: row.resource,
            action: row.action,
            environment: "test",
            formId: "frm_x",
          },
        }).allowed,
      ).toBe(false);
    }
  });

  it("refuses every act for a caller holding only the empty `member` row", () => {
    // Criterion 17: that row grants nothing on its own, so a person holding it and no
    // team reaches exactly what an administrator with no grant reaches.
    for (const row of MATRIX) {
      expect(
        decideAccess({
          memberRole: "member",
          grants: [],
          request: {
            resource: row.resource,
            action: row.action,
            environment: "test",
            formId: "frm_x",
          },
        }).allowed,
      ).toBe(false);
    }
  });

  it("carries a refusal that names the grant needed and nobody else's grant", () => {
    const decision = decideAccess({
      memberRole: undefined,
      grants: [],
      request: { resource: "response", action: "read", environment: "prod", formId: "frm_x" },
    });
    expect(decision.reason).toContain("response: read");
    expect(decision.reason).toContain("prod");
    // A refusal that named who does hold it would be a membership list for somebody Q35
    // does not give one to.
    expect(decision.reason).not.toMatch(/owner is|ask |held by/i);
  });
});

describe("the configuration guards the policy itself carries (criterion 9)", () => {
  it("declares the six roles and the three empty ones, and nothing else", () => {
    expect([...ROLE_NAMES]).toHaveLength(6);
    expect(Object.keys(roles).sort()).toEqual([...ROLE_NAMES, ...EMPTY_ROLE_NAMES].sort());
  });

  it("gives every overridden plugin role an empty statement set", () => {
    // `admin` and `member` are the two ADR-41 names; `owner` goes with them because
    // `creatorRole` is `forms.owner`, so nothing writes the plugin's own `owner` and a
    // row that carried it would otherwise hold the library's full statements.
    for (const name of EMPTY_ROLE_NAMES) {
      for (const resource of RESOURCES) {
        for (const action of ACTIONS[resource] as readonly string[]) {
          expect(roles[name].authorize({ [resource]: [action] }).success).toBe(false);
        }
      }
    }
  });

  it("gives no QCMS role any statement on the plugin's own resources (Q45)", () => {
    // The plugin's endpoints check `member: create`, `team: create` and the like. No role
    // here holds one, a `forms.owner` included, so a call that reached a plugin endpoint
    // finds no role that authorises it.
    for (const name of ROLE_NAMES) {
      for (const resource of ["organization", "member", "invitation", "team", "ac"]) {
        for (const action of ["create", "update", "delete", "read", "cancel"]) {
          expect(
            roles[name].authorize({ [resource]: [action] }).success,
            `${name} holds ${resource}:${action}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("a grant holder with several grants is judged per act, not by rank", () => {
  it("lets an editor in test and an approver in prod do each act with the right grant", () => {
    const grants = [
      {
        role: "forms.editor" as const,
        environments: ["test"],
        forms: ["all"],
        name: "test.forms.editor",
      },
      {
        role: "forms.approver" as const,
        environments: ["prod"],
        forms: ["all"],
        name: "prod.forms.approver",
      },
    ];
    const test = decideAccess({
      memberRole: undefined,
      grants,
      request: { resource: "release", action: "create", environment: "test" },
    });
    expect(test.allowed).toBe(true);
    expect(test.name).toBe("test.forms.editor");

    const prod = decideAccess({
      memberRole: undefined,
      grants,
      request: { resource: "release", action: "create", environment: "prod" },
    });
    expect(prod.allowed).toBe(true);
    expect(prod.name).toBe("prod.forms.approver");

    // And the editor's grant still does not reach a draft in prod's name, because
    // publishing is environment-agnostic and `form:write` is not on the approver.
    expect(
      decideAccess({
        memberRole: undefined,
        grants: [grants[1] as (typeof grants)[number]],
        request: { resource: "form", action: "write" },
      }).allowed,
    ).toBe(false);
  });
});

/**
 * `holdsStatement`, which is the question Q58's masking asks (task 067).
 *
 * It is deliberately **not** `decideAccess`: Q58 masks for a `forms.viewer` and shows the
 * whole URL to a `forms.editor` and above, which is a statement about the role the caller
 * holds rather than about an act they are performing. The endpoint read itself is
 * workspace-wide and environment-agnostic (the matrix's two read rows), so there is no act
 * to judge and no scope to narrow.
 */
describe("holdsStatement, the capability Q58's masking reads", () => {
  function grant(role: string, environments: readonly string[] = ["all"]) {
    return { role, environments, forms: ["all"] as readonly string[] };
  }

  it("is false for a `forms.viewer`, which is the whole of what masks it", () => {
    expect(
      holdsStatement(
        { memberRole: undefined, grants: [grant("forms.viewer")] },
        "webhook",
        "configure",
      ),
    ).toBe(false);
  });

  it("is true for a `forms.editor` and for a `forms.approver`", () => {
    for (const role of ["forms.editor", "forms.approver"]) {
      expect(
        holdsStatement({ memberRole: undefined, grants: [grant(role)] }, "webhook", "configure"),
        role,
      ).toBe(true);
    }
  });

  it("ignores the environment scope, which is the one judgement in it", () => {
    // The conservative reading of a ruling that names roles rather than scopes: a
    // `forms.editor` scoped to `test` already reads every environment's endpoint
    // configuration, production included (Q39), so masking it for that caller alone would
    // invent a per-environment meaning for a read the matrix says has none.
    expect(
      holdsStatement(
        { memberRole: undefined, grants: [grant("forms.editor", ["test"])] },
        "webhook",
        "configure",
      ),
    ).toBe(true);
  });

  it("is false for a role name no configuration declares, and for no grant at all", () => {
    // The fail-closed direction, which is the same one `grantAllows` takes: a `team.role`
    // written by hand grants nothing.
    expect(
      holdsStatement(
        { memberRole: undefined, grants: [grant("forms.wizard")] },
        "webhook",
        "configure",
      ),
    ).toBe(false);
    expect(holdsStatement({ memberRole: undefined, grants: [] }, "webhook", "configure")).toBe(
      false,
    );
  });

  it("reads the member row's role as well as the team grants", () => {
    // A `forms.owner` holds no `webhook` statement at all, so the member row cannot unmask
    // anything; what this asserts is that the row is **looked at**, so a future role that
    // did hold it would be read from there too.
    expect(holdsStatement({ memberRole: "forms.owner", grants: [] }, "membership", "write")).toBe(
      true,
    );
    expect(holdsStatement({ memberRole: "forms.owner", grants: [] }, "webhook", "configure")).toBe(
      false,
    );
  });
});
