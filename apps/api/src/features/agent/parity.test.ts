import { describe, expect, it } from "vitest";

import { ROLE_NAMES, type HeldGrant, type RoleName } from "../membership/policy.js";
import { policyForRequest, ROUTE_POLICIES } from "../membership/route-policy.js";
import { ACTION_KIND_NAMES, BUILDER_ACTION_KINDS, actionKind } from "./actions/registry.js";
import { BUILDER_SCREEN, DRAFT_EDIT_KINDS, EDIT_OPS, UNDO_KIND } from "./edit-token.js";
import { offeredActionKinds } from "./grant-filter.js";
import { SCREEN_IDS, type ScreenId } from "./screens.js";
import {
  AGENT_BUILDER_TOOL_NAMES,
  AGENT_READ_TOOL_NAMES,
  BUILDER_READ_TOOLS,
  isClaimTool,
  isFixedTextTool,
  toolCell,
  type AgentToolName,
} from "./tools/registry.js";

/**
 * Every action kind and every tool against the policy evaluator, for each role and
 * environment. The offer side is the grant filter and the tool list; the execution side is
 * `ROUTE_POLICIES`, which the route middleware reads.
 */

const ENVIRONMENTS = ["test", "prod"] as const;

function cellsOf(resource: string, action: string): string {
  return `${resource}: ${action}`;
}

/** The route a route-less kind's Confirm ends at: the builder's accept, or the screen's own download. */
const CONFIRMED_THROUGH: Readonly<
  Record<string, { readonly method: string; readonly path: string }>
> = {
  "apply-draft": { method: "POST", path: "/admin/forms/{id}/draft/assist/accept" },
  "response.export": { method: "GET", path: "/admin/forms/{id}/export" },
  "theme.derive": { method: "POST", path: "/admin/workspaces/{id}/themes/derive" },
  "theme.save": { method: "POST", path: "/admin/workspaces/{id}/themes" },
};

describe("every action kind asks for exactly what its own route asks for (criterion 90)", () => {
  it("covers the whole registry", () => {
    expect(ACTION_KIND_NAMES.length).toBeGreaterThan(25);
  });

  for (const name of ACTION_KIND_NAMES) {
    it(`${name} declares its route's own cells`, () => {
      const def = actionKind(name);
      if (def === undefined) throw new Error(name);
      if (def.route === undefined) {
        expect(def.handOff === true || def.local === true).toBe(true);
      }
      const route = def.route ?? CONFIRMED_THROUGH[name];
      if (route === undefined) throw new Error(`${name} names no route its Confirm ends at`);
      const policy = policyForRequest(route.method, route.path);
      expect(policy?.path, name).toBe(route.path);
      if (policy === undefined) throw new Error(name);
      const want = [policy, ...(policy.also ?? [])].map((cell) =>
        cellsOf(cell.resource, cell.action),
      );
      const got = [def.cell, ...(def.alsoCells ?? [])].map((cell) =>
        cellsOf(cell.resource, cell.action),
      );
      expect(got, name).toEqual(want);
    });
  }

  it("names a registered screen for every kind, so a card has a control to point at", () => {
    for (const name of ACTION_KIND_NAMES) {
      expect(SCREEN_IDS, name).toContain(actionKind(name)?.screen);
    }
  });
});

describe("no account or Site administrator act is proposable", () => {
  const siteOnly = ROUTE_POLICIES.filter((row) => row.installationOnly === true);

  it("finds the site-only routes, so the walk below is not vacuous", () => {
    expect(siteOnly.length).toBeGreaterThan(5);
    expect(siteOnly.map((row) => row.path)).toContain("/admin/accounts");
  });

  it("maps no kind onto a route no role reaches", () => {
    const reached = ACTION_KIND_NAMES.flatMap((name) => {
      const route = actionKind(name)?.route;
      if (route === undefined) return [];
      return siteOnly.some((row) => row.method === route.method && row.path === route.path)
        ? [name]
        : [];
    });
    expect(reached).toEqual([]);
  });

  it("registers no kind for an account, Site administrator or approval act", () => {
    const paths = ACTION_KIND_NAMES.flatMap((name) => actionKind(name)?.route?.path ?? []);
    for (const prefix of [
      "/admin/accounts",
      "/admin/approval-requests",
      "/admin/site-audit",
      "/admin/me/",
    ]) {
      expect(paths.filter((path) => path.startsWith(prefix))).toEqual([]);
    }
    expect(
      ACTION_KIND_NAMES.filter((name) => /^(account|administrator|approval)\./u.test(name)),
    ).toEqual([]);
  });
});

/**
 * The matrix of `docs/WORKSPACE_ACCESS.md` section 3, read as kinds: what each role's own
 * screen acts allow, in registry order. Written out rather than derived, so a cell moved in
 * the matrix fails here instead of agreeing with itself.
 */
const BY_ROLE: Readonly<Record<RoleName, readonly string[]>> = {
  "forms.viewer": [],
  "forms.editor": [
    "form.create",
    "form.saveDraft",
    "form.settings",
    "question.create",
    "question.saveDraft",
    "question.publish",
    "question.deprecate",
    "question.newVersion",
  ],
  // `form.publish` needs the editor's draft write beside the publisher's own cells, so no
  // single role is offered it: freezing a version always takes both.
  "forms.publisher": [
    "form.release",
    "form.close",
    "form.reopen",
    "link.mint",
    "link.revoke",
    "webhook.create",
    "webhook.rotate",
    "webhook.retarget",
    "webhook.reactivate",
    "webhook.deactivate",
    "webhook.redeliver",
  ],
  "forms.owner": [
    "access.groupCreate",
    "access.groupRemove",
    "access.grant",
    "access.revoke",
    "member.role",
    "workspace.settings",
  ],
  "responses.viewer": ["response.export"],
  "responses.eraser": ["response.erase", "response.unflag"],
};

function offeredFor(args: {
  readonly role: RoleName;
  readonly environments: readonly string[];
  readonly current: string;
  readonly screen?: ScreenId;
}): readonly string[] {
  // The administrator is a member row's flag rather than a group's role.
  const asMemberRole = args.role === "forms.owner";
  const grants: readonly HeldGrant[] = asMemberRole
    ? []
    : [{ roles: [args.role], environments: [...args.environments] }];
  return offeredActionKinds({
    memberRole: asMemberRole ? args.role : undefined,
    grants,
    environments: [...ENVIRONMENTS],
    current: args.current,
    ...(args.screen === undefined ? {} : { screen: args.screen }),
  }).map((entry) => entry.kind);
}

describe("what each role is offered, for each environment", () => {
  for (const role of ROLE_NAMES) {
    for (const current of ENVIRONMENTS) {
      it(`offers ${role} in ${current} the acts the matrix allows`, () => {
        expect(
          offeredFor({ role, environments: [...ENVIRONMENTS], current, screen: "/forms" }),
        ).toEqual(BY_ROLE[role]);
      });
    }
  }

  /*
   * A switcher kind is offered for the turn's own environment, so a group naming `test`
   * alone is offered none of them on `prod`. An argument kind carries its destination, so it
   * stays offered with its enum narrowed to the environments that group does name.
   */
  it("offers an environment-scoped act in no environment the role's groups leave out", () => {
    const offered = offeredActionKinds({
      memberRole: undefined,
      grants: [{ roles: ["forms.publisher"], environments: ["test"] }],
      environments: [...ENVIRONMENTS],
      current: "prod",
      screen: "/forms",
    });
    expect(offered).toEqual([{ kind: "form.release", environments: ["test"] }]);
  });

  it("offers the environment-independent acts whatever environment the switcher names", () => {
    for (const current of ENVIRONMENTS) {
      expect(
        offeredFor({ role: "forms.editor", environments: [], current, screen: "/forms" }),
      ).toEqual(BY_ROLE["forms.editor"]);
    }
  });

  it("offers a form's own screen the draft-applying kind beside the rest", () => {
    const onForm = offeredFor({
      role: "forms.editor",
      environments: [],
      current: "test",
      screen: "/forms/[formId]",
    });
    expect(onForm).toContain("apply-draft");
    expect(onForm.filter((kind) => kind !== "apply-draft")).toEqual(BY_ROLE["forms.editor"]);
  });
});

describe("the agent builder's own key sets", () => {
  it("offers the library writes and the theme acts, and no publish, release, link or webhook kind", () => {
    const offered = ACTION_KIND_NAMES.filter((name) =>
      offeredFor({
        role: "forms.editor",
        environments: [...ENVIRONMENTS],
        current: "test",
        screen: BUILDER_SCREEN,
      }).includes(name),
    );
    expect(offered).toEqual([
      "question.create",
      "question.saveDraft",
      "question.newVersion",
      "theme.derive",
      "theme.save",
    ]);
    expect(BUILDER_ACTION_KINDS).toEqual(offered);
  });

  it("offers a Publish forms role no kind at all on the builder screen", () => {
    expect(
      offeredFor({
        role: "forms.publisher",
        environments: [...ENVIRONMENTS],
        current: "prod",
        screen: BUILDER_SCREEN,
      }),
    ).toEqual([]);
  });

  it("keeps every card-less op out of the action registry, since it carries a token and no card", () => {
    expect(DRAFT_EDIT_KINDS).toEqual([...EDIT_OPS.map((op) => `draft.${op}`), UNDO_KIND]);
    for (const kind of DRAFT_EDIT_KINDS) expect(ACTION_KIND_NAMES).not.toContain(kind);
  });

  it("declares the draft-write cell on each edit tool and none on the wizard opener", () => {
    for (const name of AGENT_BUILDER_TOOL_NAMES) {
      const cell = toolCell(name);
      if (name === "open_publish_wizard") {
        // Decided per form by the publish cell in that form's workspace, so the port's
        // presence is the offer and a cell here would be a second, coarser answer.
        expect(cell).toBeUndefined();
        continue;
      }
      expect(cell, name).toEqual({ resource: "form", action: "write" });
    }
  });

  it("narrows the builder's reads to the form, its versions and the library", () => {
    for (const name of BUILDER_READ_TOOLS) expect(AGENT_READ_TOOL_NAMES).toContain(name);
    for (const name of [
      "list_responses",
      "list_links",
      "list_webhooks",
      "list_erasures",
    ] as const) {
      expect(BUILDER_READ_TOOLS).not.toContain(name);
    }
  });
});

/**
 * One read tool per admin GET route (D1). The route is named here and its cells come from
 * the policy row, so a read tool offered more widely than its own screen's read fails.
 */
const TOOL_ROUTES: Readonly<Record<AgentToolName, readonly [string, string] | undefined>> = {
  search_question_library: ["GET", "/admin/questions"],
  list_questions: ["GET", "/admin/questions"],
  read_question: ["GET", "/admin/questions/{id}"],
  diff_question_versions: ["GET", "/admin/questions/{id}"],
  question_recipes: undefined,
  propose_questions: ["PUT", "/admin/forms/{id}/draft"],
  propose_draft: ["PUT", "/admin/forms/{id}/draft"],
  validate_draft: ["PUT", "/admin/forms/{id}/draft"],
  project_draft: ["POST", "/admin/forms/{id}/draft/preview"],
  test_rule: ["POST", "/admin/forms/{id}/draft/preview-condition"],
  read_form: ["GET", "/admin/forms/{id}"],
  search_forms: ["GET", "/admin/forms"],
  list_form_versions: ["GET", "/admin/forms/{id}/versions/{v}"],
  diff_form_versions: ["GET", "/admin/forms/{id}/versions/{v}"],
  list_releases: ["GET", "/admin/forms/{id}/releases"],
  count_links: ["GET", "/admin/forms/{id}/links"],
  list_links: ["GET", "/admin/forms/{id}/links"],
  list_responses: ["GET", "/admin/forms/{id}/responses"],
  count_responses: ["GET", "/admin/forms/{id}/responses"],
  delivery_status: ["GET", "/admin/forms/{id}/deliveries"],
  list_webhooks: ["GET", "/admin/forms/{id}/webhooks"],
  count_dead_letters: ["GET", "/admin/outbox/dead-letters"],
  list_erasures: ["GET", "/admin/erasures"],
  list_workspaces: ["GET", "/admin/workspaces"],
  // It returns requireSecondApprover, which the settings route guards more tightly than members.
  read_workspace: ["GET", "/admin/workspaces/{id}/settings"],
  propose_plan: undefined,
  edit_question: undefined,
  edit_step: undefined,
  edit_rule: undefined,
  edit_copy: undefined,
  edit_appearance: undefined,
  open_publish_wizard: undefined,
};

describe("every read tool is offered where its own route admits the caller", () => {
  it("names a route for every read tool but the one that returns shipped text", () => {
    const unmapped = AGENT_READ_TOOL_NAMES.filter((name) => TOOL_ROUTES[name] === undefined);
    expect(unmapped).toEqual(["question_recipes"]);
    expect(isFixedTextTool("question_recipes")).toBe(true);
  });

  for (const name of AGENT_READ_TOOL_NAMES) {
    it(`${name} declares its route's own cell`, () => {
      const route = TOOL_ROUTES[name];
      if (route === undefined) {
        expect(toolCell(name)).toBeUndefined();
        return;
      }
      const policy = policyForRequest(route[0], route[1]);
      expect(policy?.path, name).toBe(route[1]);
      if (policy === undefined) throw new Error(name);
      if (policy.installationOnly === true) {
        // No role reaches the route, so the installation claim is the whole offer and a
        // cell would admit a caller the screen refuses.
        expect(isClaimTool(name), name).toBe(true);
        expect(toolCell(name), name).toBeUndefined();
        return;
      }
      expect(isClaimTool(name), name).toBe(false);
      expect(toolCell(name), name).toEqual({
        resource: policy.resource,
        action: policy.action,
      });
    });
  }
});
