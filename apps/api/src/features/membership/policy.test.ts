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
  roles,
  rolesHolding,
} from "./policy.js";

const EVERY_ENVIRONMENT = ["dev", "test", "prod"] as const;

function holding(role: RoleName): Parameters<typeof decideAccess>[0]["grants"] {
  return [{ roles: [role], environments: [...EVERY_ENVIRONMENT] }];
}

function allows(
  role: RoleName,
  resource: Resource,
  action: string,
  options: { readonly environment?: string } = {},
): boolean {
  return decideAccess({
    memberRole: undefined,
    grants: holding(role),
    request: { resource, action, ...options },
  }).allowed;
}

// Written out rather than derived from `rolesHolding`, which would make the assertions
// compare the statements against themselves. This is section 3's role-by-act table.
const MATRIX: readonly {
  readonly resource: Resource;
  readonly action: Action;
  readonly roles: readonly RoleName[];
}[] = [
  {
    resource: "question",
    action: "read",
    roles: ["forms.viewer", "forms.editor", "forms.publisher"],
  },
  { resource: "form", action: "read", roles: ["forms.viewer", "forms.editor", "forms.publisher"] },
  {
    resource: "release",
    action: "read",
    roles: ["forms.viewer", "forms.editor", "forms.publisher"],
  },
  { resource: "link", action: "read", roles: ["forms.viewer", "forms.editor", "forms.publisher"] },
  {
    resource: "webhook",
    action: "read",
    roles: ["forms.viewer", "forms.editor", "forms.publisher"],
  },
  { resource: "question", action: "write", roles: ["forms.editor"] },
  { resource: "form", action: "write", roles: ["forms.editor"] },
  { resource: "form", action: "preview", roles: ["forms.editor"] },
  { resource: "form", action: "publish", roles: ["forms.publisher"] },
  { resource: "release", action: "create", roles: ["forms.publisher"] },
  { resource: "form", action: "close", roles: ["forms.publisher"] },
  { resource: "link", action: "mint", roles: ["forms.publisher"] },
  { resource: "link", action: "revoke", roles: ["forms.publisher"] },
  { resource: "webhook", action: "configure", roles: ["forms.publisher"] },
  { resource: "response", action: "read", roles: ["responses.viewer"] },
  { resource: "response", action: "export", roles: ["responses.viewer"] },
  { resource: "response", action: "erase", roles: ["responses.eraser"] },
  { resource: "response", action: "dispose", roles: ["responses.eraser"] },
  { resource: "response", action: "history", roles: [] },
  { resource: "membership", action: "read", roles: ["forms.owner"] },
  { resource: "membership", action: "write", roles: ["forms.owner"] },
  { resource: "workspace", action: "read", roles: ["forms.owner"] },
  { resource: "workspace", action: "update", roles: ["forms.owner"] },
  { resource: "workspace", action: "archive", roles: ["forms.owner"] },
  { resource: "audit", action: "read", roles: ["forms.owner"] },
];

describe("the matrix is walked in both directions (criterion 1)", () => {
  it("covers every (resource, action) the policy declares", () => {
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
    const options = isEnvironmentScoped(row.resource, row.action) ? { environment: "test" } : {};
    expect(allows(role, row.resource, row.action, options)).toBe(expected);
  });

  it("agrees with the statements read back off the roles", () => {
    for (const row of MATRIX) {
      expect([...rolesHolding(row.resource, row.action)].sort()).toEqual([...row.roles].sort());
    }
  });

  it("holds no role the earlier model carried", () => {
    expect(Object.keys(roles)).not.toContain("forms.approver");
  });
});

describe("the two families imply nothing about each other (criterion 2)", () => {
  it("gives a `forms.editor` naming every environment no response anywhere", () => {
    for (const environment of EVERY_ENVIRONMENT) {
      for (const action of ["read", "export", "erase"]) {
        expect(
          allows("forms.editor", "response", action, { environment }),
          `forms.editor reached response:${action} in ${environment}`,
        ).toBe(false);
      }
    }
  });

  it("gives a Workspace administrator no response read without a group grant (criterion 19)", () => {
    const administrator = decideAccess({
      memberRole: "forms.owner",
      grants: [],
      request: { resource: "response", action: "read", environment: "prod" },
    });
    expect(administrator.allowed).toBe(false);

    const withGrant = decideAccess({
      memberRole: "forms.owner",
      grants: [{ roles: ["responses.viewer"], environments: ["prod"] }],
      request: { resource: "response", action: "read", environment: "prod" },
    });
    expect(withGrant.allowed).toBe(true);
    expect(withGrant.role).toBe("responses.viewer");
  });

  it("gives a Workspace administrator nothing on a form, release, link, webhook or response", () => {
    for (const resource of [
      "form",
      "release",
      "link",
      "webhook",
      "response",
      "question",
    ] as const) {
      for (const action of ACTIONS[resource] as readonly string[]) {
        expect(allows("forms.owner", resource, action, { environment: "test" })).toBe(false);
      }
    }
  });
});

describe("View forms and Erase responses reach no read they should not (criteria 2, 11)", () => {
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
    expect(allows("responses.eraser", "response", "read", { environment: "test" })).toBe(false);
    expect(allows("responses.eraser", "response", "export", { environment: "test" })).toBe(false);
    expect(allows("responses.eraser", "response", "erase", { environment: "test" })).toBe(true);
  });

  it("refuses a `forms.viewer` every write, publish, link, webhook and response", () => {
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
      expect(allows("forms.viewer", resource, action, { environment: "test" })).toBe(false);
    }
  });
});

describe("the environment set governs the environment-scoped acts (criteria 9, 10, 12, 14)", () => {
  it("refuses a publisher an environment its groups do not name", () => {
    const grants = [{ roles: ["forms.publisher"], environments: ["test"] }];
    const ask = (environment: string): boolean =>
      decideAccess({
        memberRole: undefined,
        grants,
        request: { resource: "link", action: "mint", environment },
      }).allowed;
    expect(ask("test")).toBe(true);
    expect(ask("dev")).toBe(false);
    expect(ask("prod")).toBe(false);
  });

  it("refuses a response role an environment its groups do not name", () => {
    const grants = [{ roles: ["responses.viewer", "responses.eraser"], environments: ["prod"] }];
    const ask = (action: string, environment: string): boolean =>
      decideAccess({
        memberRole: undefined,
        grants,
        request: { resource: "response", action, environment },
      }).allowed;
    expect(ask("read", "prod")).toBe(true);
    expect(ask("erase", "prod")).toBe(true);
    expect(ask("read", "test")).toBe(false);
    expect(ask("erase", "test")).toBe(false);
  });

  it("refuses an environment-scoped act that names no environment at all", () => {
    expect(
      decideAccess({
        memberRole: undefined,
        grants: holding("responses.viewer"),
        request: { resource: "response", action: "read" },
      }).allowed,
    ).toBe(false);
  });

  it("gives a View forms or Edit forms group the same in every environment (criterion 12)", () => {
    const grants = [{ roles: ["forms.viewer", "forms.editor"], environments: [] }];
    for (const environment of EVERY_ENVIRONMENT) {
      expect(
        decideAccess({
          memberRole: undefined,
          grants,
          request: { resource: "form", action: "write", environment },
        }).allowed,
      ).toBe(true);
    }
  });

  it("covers a newly added environment with no group (criterion 14)", () => {
    const grants = [
      { roles: ["forms.publisher", "responses.viewer"], environments: [...EVERY_ENVIRONMENT] },
    ];
    for (const [resource, action] of [
      ["release", "create"],
      ["link", "mint"],
      ["response", "read"],
    ] as const) {
      expect(
        decideAccess({
          memberRole: undefined,
          grants,
          request: { resource, action, environment: "staging" },
        }).allowed,
        `${resource}:${action} reached a new environment`,
      ).toBe(false);
    }
  });

  it("has no value meaning every environment", () => {
    expect(
      decideAccess({
        memberRole: undefined,
        grants: [{ roles: ["responses.viewer"], environments: ["all"] }],
        request: { resource: "response", action: "read", environment: "prod" },
      }).allowed,
    ).toBe(false);
  });
});

describe("publishing takes both roles (criteria 4, 6)", () => {
  it("gives Edit forms alone no `form: publish` and no `release: create`", () => {
    const grants = [{ roles: ["forms.editor"], environments: [] }];
    expect(
      decideAccess({
        memberRole: undefined,
        grants,
        request: { resource: "form", action: "publish" },
      }).allowed,
    ).toBe(false);
    expect(
      decideAccess({
        memberRole: undefined,
        grants,
        request: { resource: "release", action: "create", environment: "test" },
      }).allowed,
    ).toBe(false);
  });

  it("gives Publish forms alone no `form: write`", () => {
    expect(
      decideAccess({
        memberRole: undefined,
        grants: [{ roles: ["forms.publisher"], environments: ["test"] }],
        request: { resource: "form", action: "write" },
      }).allowed,
    ).toBe(false);
  });

  it("refuses a publisher for `test` the `prod` release, through one group or two", () => {
    const grants = [
      { roles: ["forms.editor"], environments: [] },
      { roles: ["forms.publisher"], environments: ["test"] },
    ];
    const ask = (environment: string): boolean =>
      decideAccess({
        memberRole: undefined,
        grants,
        request: { resource: "release", action: "create", environment },
      }).allowed;
    expect(ask("test")).toBe(true);
    expect(ask(PRODUCTION_ENVIRONMENT)).toBe(false);
  });
});

describe("a caller with no grant reaches nothing", () => {
  it("refuses every act for a caller with no member row and no group", () => {
    for (const row of MATRIX) {
      expect(
        decideAccess({
          memberRole: undefined,
          grants: [],
          request: { resource: row.resource, action: row.action, environment: "test" },
        }).allowed,
      ).toBe(false);
    }
  });

  it("refuses every act for a caller holding only the empty `member` row", () => {
    for (const row of MATRIX) {
      expect(
        decideAccess({
          memberRole: "member",
          grants: [],
          request: { resource: row.resource, action: row.action, environment: "test" },
        }).allowed,
      ).toBe(false);
    }
  });

  it("fails closed on a role name no configuration declares", () => {
    expect(
      decideAccess({
        memberRole: undefined,
        grants: [{ roles: ["forms.approver"], environments: ["prod"] }],
        request: { resource: "release", action: "create", environment: "prod" },
      }).allowed,
    ).toBe(false);
  });

  it("carries a refusal that names the grant needed and nobody else's grant", () => {
    const decision = decideAccess({
      memberRole: undefined,
      grants: [],
      request: { resource: "response", action: "read", environment: "prod" },
    });
    expect(decision.reason).toContain("response: read");
    expect(decision.reason).toContain("prod");
    // Naming who does hold it would leak a membership list to a caller with no grant.
    expect(decision.reason).not.toMatch(/owner is|ask |held by/i);
  });
});

describe("the configuration guards the policy itself carries", () => {
  it("declares the five group roles, the administrator and the three empty ones", () => {
    expect([...ROLE_NAMES]).toHaveLength(6);
    expect(Object.keys(roles).sort()).toEqual([...ROLE_NAMES, ...EMPTY_ROLE_NAMES].sort());
  });

  it("gives every overridden plugin role an empty statement set", () => {
    // `owner` is overridden too: `creatorRole` is the administrator role, so a row still
    // carrying the plugin's own `owner` would otherwise hold the library's full statements.
    for (const name of EMPTY_ROLE_NAMES) {
      for (const resource of RESOURCES) {
        for (const action of ACTIONS[resource] as readonly string[]) {
          expect(roles[name].authorize({ [resource]: [action] }).success).toBe(false);
        }
      }
    }
  });

  it("gives no QCMS role any statement on the plugin's own resources", () => {
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

describe("roles are additive across groups and judged per act", () => {
  it("lets an editor everywhere and a publisher in prod do each act with the right group", () => {
    const grants = [
      { roles: ["forms.editor"], environments: [], name: "Authors" },
      { roles: ["forms.publisher"], environments: ["prod"], name: "Publishers" },
    ];
    const draft = decideAccess({
      memberRole: undefined,
      grants,
      request: { resource: "form", action: "write" },
    });
    expect(draft.allowed).toBe(true);
    expect(draft.name).toBe("Authors");

    const prod = decideAccess({
      memberRole: undefined,
      grants,
      request: { resource: "release", action: "create", environment: "prod" },
    });
    expect(prod.allowed).toBe(true);
    expect(prod.name).toBe("Publishers");
  });

  it("reads every role in one group, not only its first", () => {
    const grants = [
      { roles: ["forms.editor", "forms.publisher", "responses.viewer"], environments: ["test"] },
    ];
    for (const [resource, action] of [
      ["form", "write"],
      ["release", "create"],
      ["response", "read"],
    ] as const) {
      expect(
        decideAccess({
          memberRole: undefined,
          grants,
          request: { resource, action, environment: "test" },
        }).allowed,
        `${resource}:${action}`,
      ).toBe(true);
    }
  });
});

describe("holdsStatement, which the endpoint masking reads (criterion 3)", () => {
  function grant(role: string, environments: readonly string[] = ["test", "prod"]) {
    return { roles: [role], environments };
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

  it("is true for a `forms.publisher`", () => {
    expect(
      holdsStatement(
        { memberRole: undefined, grants: [grant("forms.publisher")] },
        "webhook",
        "configure",
      ),
    ).toBe(true);
  });

  it("ignores the environment set, which is the one judgement in it", () => {
    expect(
      holdsStatement(
        { memberRole: undefined, grants: [grant("forms.publisher", ["test"])] },
        "webhook",
        "configure",
      ),
    ).toBe(true);
  });

  it("is false for a role name no configuration declares, and for no grant at all", () => {
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

  it("reads the member row's role as well as the group grants", () => {
    expect(holdsStatement({ memberRole: "forms.owner", grants: [] }, "membership", "write")).toBe(
      true,
    );
    expect(holdsStatement({ memberRole: "forms.owner", grants: [] }, "webhook", "configure")).toBe(
      false,
    );
  });
});
