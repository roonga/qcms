import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = new URL("./", import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const peopleCounts = [1, 2, 10, 100, 1000];
const environmentSets = [["test"], ["prod"], ["dev", "test", "prod"]];
const checks = [];
const cases = [];
const roleActions = {
  view: ["view"],
  edit: ["view", "edit"],
  publish: ["view", "publish", "links", "webhook", "openclose"],
  responses: ["responses", "export"],
  erase: ["erase"],
};
const active = (s, id) => s.people.get(id)?.active === true && s.people.get(id)?.ready === true;
const protectedEnvironment = (policy, env) =>
  policy === "all-environments" || (policy === "prod-only" && env === "prod");
function permitted(s, id, action, ws, form, env) {
  if (!active(s, id)) return false;
  if (action === "create") return s.creators.get(ws)?.has(id) === true;
  for (const g of s.groups) {
    if (g.pending || g.workspace !== ws || !g.forms.has(form) || !g.members.has(id)) continue;
    for (const [role, environments] of Object.entries(g.roles)) {
      if (!roleActions[role].includes(action)) continue;
      if (action === "view" || role === "edit" || role === "view" || environments.includes(env))
        return true;
    }
  }
  return false;
}
function holders(s, action, ws, form, env) {
  const found = new Set();
  for (const g of s.groups) {
    if (g.pending || g.workspace !== ws || !g.forms.has(form)) continue;
    const roleMatch = Object.entries(g.roles).some(
      ([role, environments]) =>
        roleActions[role].includes(action) &&
        (action === "view" || role === "edit" || role === "view" || environments.includes(env)),
    );
    if (roleMatch) for (const id of g.members) if (active(s, id)) found.add(id);
  }
  return found;
}
function coverage(s, obligations, approval = false) {
  const missing = [];
  for (const r of obligations) {
    const candidates = holders(s, r.action, r.workspace, r.form, r.environment);
    if (!candidates.size) missing.push({ ...r, reason: "no eligible holder" });
    if (
      approval &&
      r.action === "publish" &&
      protectedEnvironment(s.config.approval, r.environment) &&
      (!candidates.has(r.requestedBy ?? [...candidates][0]) ||
        ![...candidates].some((id) => id !== (r.requestedBy ?? [...candidates][0])))
    )
      missing.push({ ...r, reason: "no different eligible publisher" });
  }
  return missing;
}
function group(members, forms, roles, workspace) {
  return { members: new Set(members), forms: new Set(forms), roles, workspace, pending: false };
}
function fixture(c) {
  const s = {
    config: c,
    people: new Map(),
    creators: new Map(),
    groups: [],
    workspaces: [],
    rosters: [],
  };
  for (let n = 0; n < c.users; n++) s.people.set("U" + n, { active: true, ready: true });
  const ids = [...s.people.keys()];
  for (let w = 0; w < c.workspaces; w++) {
    const workspace = "W" + w,
      forms = Array.from({ length: c.forms }, (_, i) => workspace + "F" + i);
    let roster = c.pattern === "shared" ? ids : ids.filter((_, i) => i % c.workspaces === w);
    if (!roster.length) roster = [ids[w % ids.length]];
    s.rosters.push(roster);
    s.workspaces.push({ id: workspace, forms });
    s.creators.set(workspace, new Set([roster[0]]));
    if (c.pattern === "shared")
      s.groups.push(
        group(
          roster,
          forms,
          { edit: [], publish: c.envs, responses: c.envs, erase: c.envs },
          workspace,
        ),
      );
    else {
      const pick = (i) => roster[i % roster.length];
      s.groups.push(group([pick(0)], forms, { edit: [] }, workspace));
      s.groups.push(group([...new Set([pick(1), pick(2)])], forms, { publish: c.envs }, workspace));
      s.groups.push(group([pick(2)], forms, { responses: c.envs }, workspace));
      s.groups.push(group([pick(3)], forms, { erase: c.envs }, workspace));
    }
  }
  if (c.groupStress) {
    s.groups = [];
    for (let i = 0; i < 1000; i++) {
      const w = i % c.workspaces,
        roster = s.rosters[w],
        role = ["edit", "publish", "responses", "erase"][Math.floor(i / c.workspaces) % 4];
      const members = Array.from(
        { length: Math.min(10, roster.length) },
        (_, j) => roster[(i * 7 + j) % roster.length],
      );
      s.groups.push(
        group(
          members,
          s.workspaces[w].forms,
          { [role]: role === "edit" ? [] : c.envs },
          s.workspaces[w].id,
        ),
      );
    }
  }
  return s;
}
function obligations(s, stage) {
  const result = [];
  for (const ws of s.workspaces)
    for (const form of ws.forms) {
      result.push({ workspace: ws.id, form, action: "edit" });
      if (stage === "collecting")
        for (const environment of s.config.envs)
          for (const action of ["publish", "responses", "erase"])
            result.push({ workspace: ws.id, form, environment, action });
    }
  return result;
}
function addCheck(c, name, expected, actual, note = "") {
  const passed = JSON.stringify(expected) === JSON.stringify(actual);
  const row = { caseId: c.id, name, expected, actual, passed, note };
  checks.push(row);
  return row;
}
function runConfiguration(config, id) {
  const c = { ...config, id };
  const s = fixture(c);
  const first = s.workspaces[0],
    form = first.forms[0],
    creator = s.rosters[0][0],
    environment = c.envs[0];
  const configuredGroups = s.groups.length;
  const expectedApprovalBlock =
    c.approval !== "off" &&
    c.envs.some((e) => protectedEnvironment(c.approval, e)) &&
    s.rosters.some((r) => r.length < 2);
  const start = checks.length;
  const createOnly = globalThis.structuredClone(s);
  createOnly.groups = [];
  addCheck(
    c,
    "Creation membership grants creation only",
    [true, false, false, false],
    [
      permitted(createOnly, creator, "create", first.id),
      permitted(createOnly, creator, "view", first.id, form),
      permitted(createOnly, creator, "edit", first.id, form),
      permitted(createOnly, creator, "responses", first.id, form, environment),
    ],
  );
  addCheck(
    c,
    "Draft responsibilities covered",
    "READY",
    coverage(s, obligations(s, "draft")).length ? "BLOCKED" : "READY",
    "Draft-editor checkpoint is a proposed lifecycle rule.",
  );
  const liveMissing = coverage(s, obligations(s, "collecting"), true);
  addCheck(
    c,
    "Collecting and independent-approval readiness",
    expectedApprovalBlock ? "BLOCKED" : "READY",
    liveMissing.length ? "BLOCKED" : "READY",
    expectedApprovalBlock
      ? "A protected environment has fewer than two authorised publishers in at least one workspace."
      : "Explicit permissions cover each declared environment and responsibility.",
  );
  addCheck(
    c,
    "No access to unassigned form",
    false,
    permitted(s, creator, "view", first.id, "UNASSIGNED_FORM"),
  );
  addCheck(
    c,
    "No creation in unassigned workspace",
    false,
    permitted(s, creator, "create", "UNASSIGNED_WORKSPACE"),
  );
  addCheck(
    c,
    "No access to newly added environment",
    false,
    permitted(s, creator, "publish", first.id, form, "NEW_ENVIRONMENT"),
  );
  const separated = globalThis.structuredClone(s);
  separated.groups = [
    group([creator], [form], { responses: [environment], publish: [] }, first.id),
  ];
  addCheck(
    c,
    "Response environment cannot authorise publishing",
    [true, false],
    [
      permitted(separated, creator, "responses", first.id, form, environment),
      permitted(separated, creator, "publish", first.id, form, environment),
    ],
  );
  const empty = globalThis.structuredClone(s);
  empty.groups = [group([], first.forms, { edit: [] }, first.id)];
  addCheck(
    c,
    "Empty editor group is not coverage",
    true,
    coverage(empty, [{ workspace: first.id, form, action: "edit" }]).length > 0,
  );
  const pending = globalThis.structuredClone(s);
  pending.groups = [group([creator], first.forms, { edit: [] }, first.id)];
  pending.groups[0].pending = true;
  addCheck(
    c,
    "Pending editor grant is not coverage",
    true,
    coverage(pending, [{ workspace: first.id, form, action: "edit" }]).length > 0,
  );
  const disabled = globalThis.structuredClone(s);
  disabled.groups = [group([creator], first.forms, { edit: [] }, first.id)];
  disabled.people.get(creator).active = false;
  addCheck(
    c,
    "Disabled sole editor is not coverage",
    true,
    coverage(disabled, [{ workspace: first.id, form, action: "edit" }]).length > 0,
  );
  const removedCreator = globalThis.structuredClone(s);
  const editor = [...holders(s, "edit", first.id, form)][0];
  removedCreator.creators.get(first.id).add(editor);
  removedCreator.creators.get(first.id).delete(editor);
  addCheck(
    c,
    "Removing creation membership preserves separate editing",
    [false, true],
    [
      permitted(removedCreator, editor, "create", first.id),
      permitted(removedCreator, editor, "edit", first.id, form),
    ],
  );
  const replacement = globalThis.structuredClone(s);
  const other = [...s.people.keys()].find((p) => p !== editor);
  replacement.groups = [group(other ? [other] : [], first.forms, { edit: [] }, first.id)];
  addCheck(
    c,
    "Different-person editor handover requires an eligible replacement",
    c.users > 1 ? "READY" : "BLOCKED",
    coverage(replacement, [{ workspace: first.id, form, action: "edit" }]).length
      ? "BLOCKED"
      : "READY",
    "This checks an ordinary different-person handover; not an emergency-suspension policy.",
  );
  cases.push({
    ...c,
    formAccessGroups: configuredGroups,
    minimumWorkspaceUsers: Math.min(...s.rosters.map((x) => x.length)),
    draft: coverage(s, obligations(s, "draft")).length ? "BLOCKED" : "READY",
    collection: liveMissing.length ? "BLOCKED" : "READY",
    expectedCollection: expectedApprovalBlock ? "BLOCKED" : "READY",
    checkCount: checks.length - start,
    passed: checks.slice(start).every((x) => x.passed),
    reason: expectedApprovalBlock
      ? "Protected work has no different eligible publisher."
      : "All declared responsibilities are covered.",
  });
}
let next = 1;
for (const users of peopleCounts)
  for (const envs of environmentSets)
    for (const workspaces of [1, 3])
      for (const forms of [1, 10])
        for (const pattern of ["shared", "departmental"])
          for (const approval of ["off", "prod-only", "all-environments"])
            runConfiguration(
              { users, envs, workspaces, forms, pattern, approval, groupStress: false },
              "C" + String(next++).padStart(3, "0"),
            );
for (const users of [1, 100, 1000])
  for (const approval of ["off", "prod-only", "all-environments"])
    runConfiguration(
      {
        users,
        envs: ["dev", "test", "prod"],
        workspaces: 3,
        forms: 10,
        pattern: "departmental",
        approval,
        groupStress: true,
      },
      "C" + String(next++).padStart(3, "0"),
    );

const targeted = [];
function target(id, title, expected, actual, note) {
  const row = {
    id,
    title,
    expected,
    actual,
    passed: JSON.stringify(expected) === JSON.stringify(actual),
    note,
  };
  targeted.push(row);
}
const tiny = fixture({
  users: 2,
  envs: ["prod"],
  workspaces: 1,
  forms: 1,
  pattern: "shared",
  approval: "off",
});
const r = { workspace: "W0", form: "W0F0", action: "edit" };
const oneRemoved = globalThis.structuredClone(tiny);
oneRemoved.groups[0].members.delete("U0");
const otherRemoved = globalThis.structuredClone(tiny);
otherRemoved.groups[0].members.delete("U1");
const bothRemoved = globalThis.structuredClone(tiny);
bothRemoved.groups[0].members.clear();
target(
  "T01",
  "Two stale removal checks can jointly orphan a form",
  [0, 0, 1],
  [
    coverage(oneRemoved, [r]).length,
    coverage(otherRemoved, [r]).length,
    coverage(bothRemoved, [r]).length,
  ],
  "Counterexample: real implementation must serialise final-state checks.",
);
const serial = globalThis.structuredClone(oneRemoved);
serial.groups[0].members.delete("U1");
target(
  "T02",
  "Serialised final-state validation refuses the second removal",
  "REFUSED",
  coverage(serial, [r]).length ? "REFUSED" : "ALLOWED",
  "Model refusal, not a database lock test.",
);
const self = fixture({
  users: 1,
  envs: ["prod"],
  workspaces: 1,
  forms: 1,
  pattern: "shared",
  approval: "off",
});
const pendingOnly = globalThis.structuredClone(self);
pendingOnly.groups[0].pending = true;
target(
  "T03",
  "A saved draft with pending-only access has no editor",
  "UNCOVERED",
  coverage(pendingOnly, [r]).length ? "UNCOVERED" : "COVERED",
  "Demonstrates why pending-creation semantics require a decision.",
);
const compromised = globalThis.structuredClone(self);
compromised.people.get("U0").active = false;
target(
  "T04",
  "Strict coverage would refuse suspension of a compromised sole operator",
  "BLOCKED",
  coverage(compromised, [r]).length ? "BLOCKED" : "READY",
  "Correct result under strict preservation, but an unresolved security tradeoff, not an endorsed recovery policy.",
);
const provisional = globalThis.structuredClone(self);
provisional.people.get("U0").ready = false;
target(
  "T05",
  "Provisional unusable account does not count as coverage",
  "UNCOVERED",
  coverage(provisional, [r]).length ? "UNCOVERED" : "COVERED",
  "Eligible means usable active account, not merely a configured role.",
);
const authorOmitted = globalThis.structuredClone(tiny);
authorOmitted.groups = [group(["U1"], ["W0F0"], { edit: [] }, "W0")];
target(
  "T06",
  "Creator assigns another editor and omits self",
  [false, true, 0],
  [
    permitted(authorOmitted, "U0", "edit", "W0", "W0F0"),
    permitted(authorOmitted, "U1", "edit", "W0", "W0F0"),
    coverage(authorOmitted, [r]).length,
  ],
  "Desired final access state only; named-user storage and creation API are not implemented.",
);
const eraser = globalThis.structuredClone(self);
eraser.groups = [group(["U0"], ["W0F0"], { erase: ["prod"] }, "W0")];
target(
  "T07",
  "Erasure authority does not imply viewing/export",
  [true, false, false],
  [
    permitted(eraser, "U0", "erase", "W0", "W0F0", "prod"),
    permitted(eraser, "U0", "responses", "W0", "W0F0", "prod"),
    permitted(eraser, "U0", "export", "W0", "W0F0", "prod"),
  ],
  "Response reading/export remains a separate capability.",
);
const closed = globalThis.structuredClone(self);
closed.groups = [group(["U0"], ["W0F0"], { responses: ["prod"], erase: ["prod"] }, "W0")];
target(
  "T08",
  "Closed form with enabled reopening still needs operations coverage",
  "UNCOVERED",
  coverage(closed, [{ ...r, action: "publish", environment: "prod" }]).length
    ? "UNCOVERED"
    : "COVERED",
  "Closed is not retired; only explicitly retired operations stop requiring coverage.",
);
const retained = globalThis.structuredClone(self);
retained.groups = [group(["U0"], ["W0F0"], { publish: ["prod"] }, "W0")];
target(
  "T09",
  "Retained responses need response-management coverage",
  ["responses", "erase"],
  coverage(retained, [
    { ...r, action: "responses", environment: "prod" },
    { ...r, action: "erase", environment: "prod" },
  ]).map((x) => x.action),
  "Lifecycle policy is proposed; retained data cannot silently lose enabled duties.",
);
const many = fixture({
  users: 100,
  envs: ["prod"],
  workspaces: 1,
  forms: 1,
  pattern: "shared",
  approval: "prod-only",
});
many.groups = [group(["U0"], ["W0F0"], { publish: ["prod"] }, "W0")];
target(
  "T10",
  "100 accounts but only one publisher is insufficient for independent approval",
  "BLOCKED",
  coverage(many, [{ ...r, action: "publish", environment: "prod" }], true).length
    ? "BLOCKED"
    : "READY",
  "Count authorised people, not headcount.",
);
const revoked = globalThis.structuredClone(tiny);
revoked.config.approval = "prod-only";
revoked.people.get("U1").active = false;
target(
  "T11",
  "Disabling the only independent publisher loses approval coverage",
  "BLOCKED",
  coverage(revoked, [{ ...r, action: "publish", environment: "prod" }], true).length
    ? "BLOCKED"
    : "READY",
  "Permission and eligibility must be rechecked when an approval is applied.",
);
const overlap = globalThis.structuredClone(tiny);
overlap.groups = [
  group(["U0"], ["W0F0"], { edit: [] }, "W0"),
  group(["U0"], ["W0F0"], { edit: [] }, "W0"),
];
overlap.groups.shift();
target(
  "T12",
  "Another group can preserve access after one membership is removed",
  true,
  permitted(overlap, "U0", "edit", "W0", "W0F0"),
  "Effective access is the union of remaining grants.",
);
const inherited = globalThis.structuredClone(self);
inherited.groups = [group(["U0"], ["W0F0"], { edit: [] }, "W0")];
target(
  "T13",
  "Editor inherits viewing but not creation in another workspace",
  [true, false],
  [permitted(inherited, "U0", "view", "W0", "W0F0"), permitted(inherited, "U0", "create", "W1")],
  "Creation-only workspace membership is separate.",
);
const lower = globalThis.structuredClone(self);
lower.groups = [group(["U0"], ["W0F0"], { erase: ["test"] }, "W0")];
target(
  "T14",
  "Erasure can be allowed in test without prod",
  [true, false],
  [
    permitted(lower, "U0", "erase", "W0", "W0F0", "test"),
    permitted(lower, "U0", "erase", "W0", "W0F0", "prod"),
  ],
  "Environment selection is explicit and not restricted to production.",
);
const protectedCandidate = globalThis.structuredClone(tiny);
protectedCandidate.config.approval = "prod-only";
protectedCandidate.groups = [group(["U1"], ["W0F0"], { publish: ["prod"] }, "W0")];
const requestAuthor = "U0";
const candidates = holders(protectedCandidate, "publish", "W0", "W0F0", "prod");
target(
  "T15",
  "One publisher different from a frozen version author can approve that exact version",
  true,
  [...candidates].some((id) => id !== requestAuthor),
  "Exact-request eligibility differs from blanket future readiness requiring two publishers. This distinction needs lifecycle/publishing-flow treatment.",
);

function administratorGaps(s, installation, workspaces) {
  const result = [];
  if (![...installation].some((id) => active(s, id))) result.push("installation");
  for (const [ws, members] of workspaces)
    if (![...members].some((id) => active(s, id))) result.push(ws);
  return result;
}
const adminState = globalThis.structuredClone(tiny);
const installation = new Set(["U0"]);
const workspaceAdmins = new Map([["W0", new Set(["U0"])]]);
target(
  "T16",
  "Last active Installation administrator cannot be demoted",
  ["installation"],
  administratorGaps(adminState, new Set(), workspaceAdmins),
  "Administrator continuity is separate from form task coverage.",
);
target(
  "T17",
  "Installation privilege does not replace explicit Workspace administrator membership",
  ["W0"],
  administratorGaps(adminState, installation, new Map([["W0", new Set()]])),
  "An installation role alone does not satisfy the workspace membership invariant.",
);
target(
  "T18",
  "Atomic Workspace administrator handover preserves continuity",
  [],
  administratorGaps(adminState, installation, new Map([["W0", new Set(["U1"])]])),
  "The replacement must be an eligible account; final state is checked together.",
);
const adminDisabled = globalThis.structuredClone(adminState);
adminDisabled.people.get("U0").active = false;
target(
  "T19",
  "Disabling sole administrator affects every workspace",
  ["installation", "W0", "W1"],
  administratorGaps(
    adminDisabled,
    installation,
    new Map([
      ["W0", new Set(["U0"])],
      ["W1", new Set(["U0"])],
    ]),
  ),
  "Strict continuity flags all affected duties. Emergency suspension still needs an explicit policy.",
);
const adminA = administratorGaps(adminState, installation, new Map([["W0", new Set(["U0"])]]));
const adminB = administratorGaps(adminState, installation, new Map([["W0", new Set(["U1"])]]));
const adminBoth = administratorGaps(adminState, installation, new Map([["W0", new Set()]]));
target(
  "T20",
  "Two uncoordinated Workspace administrator removals can violate continuity",
  [0, 0, 1],
  [adminA.length, adminB.length, adminBoth.length],
  "Another stale-read counterexample; no real transaction locking is tested.",
);

const disjoint = fixture({
  users: 100,
  envs: ["dev", "test", "prod"],
  workspaces: 1,
  forms: 2,
  pattern: "shared",
  approval: "off",
});
disjoint.groups = [
  group(
    ["U0"],
    ["W0F0"],
    { edit: [], publish: ["test"], responses: ["prod"], erase: ["test"] },
    "W0",
  ),
  group(["U1"], ["W0F1"], { edit: [], publish: ["prod"], responses: ["test"] }, "W0"),
];
target(
  "T21",
  "Different form groups stay isolated within one workspace",
  [true, false, true, false],
  [
    permitted(disjoint, "U0", "view", "W0", "W0F0"),
    permitted(disjoint, "U0", "view", "W0", "W0F1"),
    permitted(disjoint, "U1", "view", "W0", "W0F1"),
    permitted(disjoint, "U1", "view", "W0", "W0F0"),
  ],
  "Creation membership and another person's group cannot supply access to the other form.",
);
target(
  "T22",
  "Non-empty independent role environment scopes",
  [true, false, true, false, true, false],
  [
    permitted(disjoint, "U0", "publish", "W0", "W0F0", "test"),
    permitted(disjoint, "U0", "publish", "W0", "W0F0", "prod"),
    permitted(disjoint, "U0", "responses", "W0", "W0F0", "prod"),
    permitted(disjoint, "U0", "responses", "W0", "W0F0", "test"),
    permitted(disjoint, "U0", "erase", "W0", "W0F0", "test"),
    permitted(disjoint, "U0", "erase", "W0", "W0F0", "prod"),
  ],
  "Publishing=test; response reading=prod; erasure=test. Each has an allowed and refused probe.",
);
const rescope = globalThis.structuredClone(disjoint);
rescope.groups[0].forms = new Set(["W0F1"]);
target(
  "T23",
  "Rescoping the sole F1 editing group can uncover F1",
  [true, false],
  [
    coverage(rescope, [{ workspace: "W0", form: "W0F0", action: "edit" }]).length > 0,
    coverage(rescope, [{ workspace: "W0", form: "W0F1", action: "edit" }]).length > 0,
  ],
  "An ordinary-change coverage guard must refuse this state until F1 has a replacement.",
);
const complementary = globalThis.structuredClone(disjoint);
complementary.groups = [
  group(["U0"], ["W0F0"], { edit: [] }, "W0"),
  group(["U0"], ["W0F1"], { publish: ["prod"] }, "W0"),
];
target(
  "T24",
  "Roles on different forms cannot combine into publishing authority",
  [true, true, false],
  [
    permitted(complementary, "U0", "edit", "W0", "W0F0"),
    permitted(complementary, "U0", "publish", "W0", "W0F1", "prod"),
    permitted(complementary, "U0", "publish", "W0", "W0F0", "prod"),
  ],
  "Editing F1 plus publishing F2 does not permit publishing F1.",
);
const differentApproverForm = globalThis.structuredClone(disjoint);
differentApproverForm.config.approval = "prod-only";
differentApproverForm.groups = [
  group(["U0"], ["W0F0"], { publish: ["prod"] }, "W0"),
  group(["U1"], ["W0F1"], { publish: ["prod"] }, "W0"),
];
target(
  "T25",
  "Publisher for another form cannot supply an independent approver",
  "BLOCKED",
  coverage(
    differentApproverForm,
    [{ workspace: "W0", form: "W0F0", action: "publish", environment: "prod" }],
    true,
  ).length
    ? "BLOCKED"
    : "READY",
  "The second person needs the exact form/environment authority.",
);
const crossFormOverlap = globalThis.structuredClone(disjoint);
crossFormOverlap.groups = [
  group(["U0"], ["W0F0"], { edit: [] }, "W0"),
  group(["U0"], ["W0F0"], { edit: [] }, "W0"),
  group(["U0"], ["W0F1"], { view: [] }, "W0"),
];
crossFormOverlap.groups.shift();
target(
  "T26",
  "Overlapping membership preserves only actual form permissions",
  [true, true, false, false],
  [
    permitted(crossFormOverlap, "U0", "edit", "W0", "W0F0"),
    permitted(crossFormOverlap, "U0", "view", "W0", "W0F1"),
    permitted(crossFormOverlap, "U0", "edit", "W0", "W0F1"),
    permitted(crossFormOverlap, "U0", "publish", "W0", "W0F1", "prod"),
  ],
  "The remaining F1 editor group preserves F1 editing; the F2 viewer group grants neither F2 editing nor publishing.",
);

function suspendAccount(state, id, emergency) {
  const next = globalThis.structuredClone(state);
  next.sessions ??= new Map();
  next.sessions.set(id, []);
  next.people.get(id).active = false;
  const affected = coverage(next, obligations(next, "collecting"), true);
  if (!emergency && affected.length) return { status: "REFUSED", state };
  next.audit ??= [];
  next.audit.push({ action: "account.suspended", user: id, emergency, affected });
  return { status: "SUSPENDED", state: next };
}
const emergencySource = globalThis.structuredClone(self);
emergencySource.sessions = new Map([["U0", ["session-a", "session-b"]]]);
const emergencyResult = suspendAccount(emergencySource, "U0", true);
target(
  "T27",
  "Emergency account suspension is immediate despite sole-operator coverage",
  "SUSPENDED",
  emergencyResult.status,
  "Accepted security exception; affected actions are blocked and audited until authorised replacement.",
);
target(
  "T28",
  "One account suspension makes all group permissions ineffective without deleting memberships",
  [false, false, 0, true],
  [
    permitted(emergencyResult.state, "U0", "edit", "W0", "W0F0"),
    permitted(emergencyResult.state, "U0", "responses", "W0", "W0F0", "prod"),
    emergencyResult.state.sessions.get("U0").length,
    emergencyResult.state.groups[0].members.has("U0"),
  ],
  "Sessions and effective permissions are invalidated globally; memberships remain as records. This is a model transition, not an authentication integration test.",
);
target(
  "T29",
  "Emergency suspension may leave last-administrator duties uncovered for operator recovery",
  ["installation", "W0"],
  administratorGaps(emergencyResult.state, new Set(["U0"]), new Map([["W0", new Set(["U0"])]])),
  "The accepted emergency exception is distinct from ordinary succession. No implicit replacement access is granted.",
);
target(
  "T30",
  "Ordinary removal still requires coverage-preserving handover",
  "REFUSED",
  suspendAccount(emergencySource, "U0", false).status,
  "Emergency mode is explicit and audited; ordinary changes retain the no-orphan guard.",
);
function creationRequest(state, selected, requiresApproval, requester = "U0") {
  const workspace = state.workspaces[0].id;
  const request = {
    status: requiresApproval ? "AWAITING_APPROVAL" : "READY",
    selected: [...selected],
  };
  if (!permitted(state, requester, "create", workspace))
    return { request: { ...request, status: "REFUSED" }, created: false, state };
  const proposed = globalThis.structuredClone(state);
  for (const index of selected) {
    if (!proposed.groups[index] || proposed.groups[index].workspace !== workspace)
      return { request: { ...request, status: "REFUSED" }, created: false, state };
    proposed.groups[index].forms.add("NEW_FORM");
  }
  if (coverage(proposed, [{ workspace, form: "NEW_FORM", action: "edit" }]).length)
    return { request: { ...request, status: "REFUSED" }, created: false, state };
  if (requiresApproval) return { request, created: false, state };
  proposed.workspaces[0].forms.push("NEW_FORM");
  return { request: { ...request, status: "CREATED" }, created: true, state: proposed };
}
const waitingCreation = creationRequest(self, [0], true);
target(
  "T31",
  "Initial approval holds the entire creation request",
  [false, false, "AWAITING_APPROVAL"],
  [
    waitingCreation.created,
    waitingCreation.state.workspaces[0].forms.includes("NEW_FORM"),
    waitingCreation.request.status,
  ],
  "No active form or grants exist while initial approval is pending. An active eligible editor is still required before applying the request.",
);
const appliedCreation = creationRequest(
  waitingCreation.state,
  waitingCreation.request.selected,
  false,
);
target(
  "T32",
  "Approved creation applies form and group assignments together",
  [true, true, true],
  [
    appliedCreation.created,
    appliedCreation.state.workspaces[0].forms.includes("NEW_FORM"),
    appliedCreation.state.groups[0].forms.has("NEW_FORM"),
  ],
  "Group-only desired-state fixture; actual transaction/approval versioning and authority remain application work.",
);
const onePublisherDraft = globalThis.structuredClone(self);
onePublisherDraft.config.approval = "prod-only";
target(
  "T33",
  "A draft does not require a standing second publisher",
  "READY",
  coverage(onePublisherDraft, obligations(onePublisherDraft, "draft"), true).length
    ? "BLOCKED"
    : "READY",
  "Independent approval is checked when the protected action is requested, not as a permanent two-publisher form invariant.",
);
const exactRequest = globalThis.structuredClone(tiny);
exactRequest.config.approval = "prod-only";
target(
  "T34",
  "Protected publishing checks a different eligible person for the exact request",
  "READY",
  coverage(
    exactRequest,
    [{ ...r, action: "publish", environment: "prod", requestedBy: "U0" }],
    true,
  ).length
    ? "BLOCKED"
    : "READY",
  "A named requester has a different active publisher on the same form/environment; unrelated users cannot substitute.",
);

const noEditor = globalThis.structuredClone(self);
noEditor.groups[0].members.clear();
const noEditorCreation = creationRequest(noEditor, [0], false);
target(
  "T35",
  "Creation refuses an assigned group with no eligible editor",
  [false, "REFUSED"],
  [noEditorCreation.created, noEditorCreation.request.status],
  "Draft editor coverage is revalidated before a form becomes active.",
);
const publishOnlyInitial = globalThis.structuredClone(self);
publishOnlyInitial.groups[0].roles = { publish: ["prod"] };
target(
  "T36",
  "Initial publisher/view permission cannot substitute for editing",
  "REFUSED",
  creationRequest(publishOnlyInitial, [0], false).request.status,
  "Viewing inherited from Publish forms does not satisfy the editor obligation.",
);
const changedWhilePending = globalThis.structuredClone(waitingCreation.state);
changedWhilePending.groups[0].members.clear();
target(
  "T37",
  "Creation approval rechecks editor eligibility before committing",
  "REFUSED",
  creationRequest(changedWhilePending, waitingCreation.request.selected, false).request.status,
  "A queued request does not freeze the eligibility of its group holders.",
);
const creatorRevoked = globalThis.structuredClone(waitingCreation.state);
creatorRevoked.creators.get("W0").clear();
target(
  "T38",
  "Creation approval refuses a requester who lost creation permission",
  "REFUSED",
  creationRequest(creatorRevoked, waitingCreation.request.selected, false).request.status,
  "Recheck current authority at application, not merely at request submission.",
);

const invalidRequester = globalThis.structuredClone(exactRequest);
invalidRequester.groups = [group(["U1"], ["W0F0"], { publish: ["prod"] }, "W0")];
target(
  "T39",
  "Independent approval cannot replace missing requester permission",
  "BLOCKED",
  coverage(
    invalidRequester,
    [{ ...r, action: "publish", environment: "prod", requestedBy: "U0" }],
    true,
  ).length
    ? "BLOCKED"
    : "READY",
  "Both requester authority and a different eligible approver are rechecked for the exact protected action.",
);

const failedChecks = checks.filter((x) => !x.passed),
  failedTargets = targeted.filter((x) => !x.passed);
const result = {
  kind: "standalone plan/scenario model; not application, API, database, UX usability or throughput testing",
  runAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  runnerSha256: createHash("sha256")
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .digest("hex"),
  dimensions: {
    users: peopleCounts,
    environments: environmentSets,
    workspaces: [1, 3],
    formsPerWorkspace: [1, 10],
    arrangements: ["shared", "departmental"],
    approvalPolicies: ["off", "prod-only", "all-environments"],
    extraGroupFixtures:
      "1,000 form access groups for 1, 100 and 1,000 accounts, each with 3 policy variants",
  },
  assumptions: [
    "Baseline groups cover every fixture form and role environments use the same environment set. T21-T26 separately test disjoint/overlapping form scopes and non-empty independent role environment scopes; these are not factorial scope dimensions.",
    "Initial form access is group-only. The fixtures and creation transition reference existing groups, not direct user ACLs. Creating/updating memberships remains separate administrative work.",
    "Accepted checkpoints: an eligible editor for drafts; publishing/response/erase coverage before collection; retained-data and still-enabled operations remain covered after closure.",
    "Approval off, prod-only and all-environments are sensitivity variants, not three accepted configuration options.",
    "Baseline collection readiness includes a specific publish request from an eligible publisher in each destination. That request needs a different eligible approver where policy applies. Drafts do not have a permanent two-publisher requirement (T33-T34). T15 is only an authorship-difference probe, not a complete approval request.",
    "Shared means all fixture accounts explicitly hold all form roles; departmental means account rosters split by workspace and roles split within each roster. Empty workspace rosters reuse an existing account to preserve a one-person multi-workspace case.",
    "Ineligible includes disabled or unusable provisional accounts. Logged-in presence is not required.",
    "Ordinary removal preserves coverage. Accepted emergency suspension immediately blocks the account/sessions across all memberships, records affected duties, and may include the last administrator; authorised operator recovery is required. Tests model this without proving real token/session enforcement.",
    "No actual forms are created and no actual approvals, erasures or exports execute. Database transaction/concurrency safety and production performance remain untested.",
    "Administrator continuity is checked in targeted final-state fixtures, not across the baseline matrix. Exact creation allocation, initial recipient storage, approval request state transitions, actual archive transitions and real credential recovery are not implemented or end-to-end tested.",
  ],
  summary: {
    configurationCount: cases.length,
    configurationChecks: checks.length,
    targetedCases: targeted.length,
    totalChecks: checks.length + targeted.length,
    passedChecks: checks.filter((x) => x.passed).length + targeted.filter((x) => x.passed).length,
    failedChecks: failedChecks.length + failedTargets.length,
    readyConfigurations: cases.filter((x) => x.collection === "READY").length,
    expectedBlockedConfigurations: cases.filter((x) => x.collection === "BLOCKED").length,
  },
  cases,
  checks,
  targeted,
};
const jsonPath = new URL("workspace-access-scenario-results.json", here);
writeFileSync(jsonPath, JSON.stringify(result, null, 2) + "\n");
function cell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
const format = (v) => (typeof v === "string" ? v : JSON.stringify(v));
const byUsers = peopleCounts.map((users) => {
  const list = cases.filter((c) => c.users === users);
  return {
    users,
    configurations: list.length,
    ready: list.filter((c) => c.collection === "READY").length,
    blocked: list.filter((c) => c.collection === "BLOCKED").length,
  };
});
const md = [
  "# Workspace access: scenario test cases and results",
  "",
  `Run: ${result.runAt}. Code snapshot: \`${result.commit.slice(0, 8)}\`. Runner: \`node plan/workspace-access-scenarios.mjs\`.`,
  `Runner SHA-256: \`${result.runnerSha256}\`. Runtime: ${result.node} on ${result.platform}.`,
  "",
  "## What was tested",
  "",
  result.kind + ".",
  "",
  `**${result.summary.passedChecks}/${result.summary.totalChecks} assertions passed** across **${cases.length} configurations** and **${targeted.length} targeted cases**. ${result.summary.readyConfigurations} configurations were ready for all declared collecting responsibilities; ${result.summary.expectedBlockedConfigurations} were correctly blocked by missing independent-publisher coverage. A passing refusal assertion is not a successful business workflow.`,
  "",
  "## Results by account count",
  "",
  "| Total accounts | Configurations | Ready | Correctly blocked |",
  "|---|---|---|---|",
  ...byUsers.map((x) => "| " + [x.users, x.configurations, x.ready, x.blocked].join(" | ") + " |"),
  "",
  "## Test dimensions",
  "",
  "| Dimension | Values |",
  "|---|---|",
  ...Object.entries(result.dimensions).map(([k, v]) => "| " + k + " | " + cell(format(v)) + " |"),
  "",
  "## Assumptions and limits",
  "",
  ...result.assumptions.map((x) => "- " + x),
  "",
  "## Important outcomes",
  "",
  "- One eligible person can cover every declared task with explicit self-assignment and approval off, across one or three environments and workspaces.",
  "- One eligible person cannot provide an independent second approval. A test-only environment works under the prod-only sensitivity policy; all-environment approval blocks it.",
  "- Headcount alone is insufficient. A departmental workspace with one eligible publisher is blocked even if another department has more people.",
  "- Draft editing can remain available while collecting-environment coverage is blocked under the proposed lifecycle rule.",
  "- Empty, pending and disabled assignments do not count; new forms/environments and response scopes do not silently grant other access.",
  "- Ordinary removals preserve coverage; accepted emergency suspension bypasses that guard with audit/remediation and no silent replacement. T04 records the strict-policy counterexample; T27-T30 exercise the accepted exception.",
  "- Approval readiness belongs to the exact requested action, not a standing number of publishers on every draft (T33-T34).",
  "",
  "## Twelve checks for every configuration",
  "",
  ...checks
    .filter((x) => x.caseId === "C001")
    .map(
      (x, i) =>
        `${i + 1}. **${x.name}**. Expected: ${format(x.expected)}. Actual: ${format(x.actual)}. ${x.passed ? "PASS" : "FAIL"}. ${x.note}`,
    ),
  "",
  "## Targeted lifecycle and refusal cases",
  "",
  "| ID | Case | Expected | Actual | Result | Interpretation |",
  "|---|---|---|---|---|---|",
  ...targeted.map(
    (x) =>
      "| " +
      [x.id, x.title, format(x.expected), format(x.actual), x.passed ? "PASS" : "FAIL", x.note]
        .map(cell)
        .join(" | ") +
      " |",
  ),
  "",
  "## Full configuration matrix",
  "",
  "Users are total accounts in the fixture. Forms are per workspace. READY/BLOCKED is the observed collecting-readiness outcome; assertions pass only when this matches the independently derived expected outcome and all refusal/coverage probes match.",
  "",
  "| ID | Users | Environments | Workspaces | Forms/workspace | Arrangement | Form groups | Approval variant | Minimum people/workspace | Expected | Actual | Assertions |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...cases.map(
    (c) =>
      "| " +
      [
        c.id,
        c.users,
        c.envs.join(", "),
        c.workspaces,
        c.forms,
        c.groupStress ? "1,000-group fixture" : c.pattern,
        c.formAccessGroups,
        c.approval,
        c.minimumWorkspaceUsers,
        c.expectedCollection,
        c.collection,
        c.passed ? "12/12 PASS" : "FAIL",
      ].join(" | ") +
      " |",
  ),
  "",
  "## Accepted decisions and implementation work still required",
  "",
  "1. Implement accepted lifecycle checkpoints, including retained-data and still-enabled operations after closure.",
  "2. Implement groups-only initial access without changing unrelated group memberships. Response-access administration remains a separate authorised task.",
  "3. Implement whole-request pending creation: no active form before approval, atomic form/assignment creation afterward.",
  "4. Specify the audited operator recovery procedure after accepted emergency suspension, including the last administrator.",
  "5. Implement action-specific approver eligibility and determine policy environment coverage; freeze/version the exact protected request.",
  "",
  "## Evidence and implementation boundary",
  "",
  "- [Machine-readable full results](workspace-access-scenario-results.json)",
  "- [Reproducible scenario runner](workspace-access-scenarios.mjs)",
  "- [Readable HTML report](workspace-access-scenario-results.html)",
  "- [Access user guide](workspace-access-explainer.html)",
  "- [Design and current-code comparison](workspace-access-completeness.md)",
  "",
  "Application/API/database integration, real offboarding and approval workflows, UI usability with 100/1,000 people, query bounds, load/throughput and actual race safety remain unverified for the new design.",
  "",
];
writeFileSync(new URL("workspace-access-test-cases.md", here), md.join("\n") + "\n");
const escape = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const targetedHtml = targeted
  .map(
    (x) =>
      `<tr><th scope="row">${x.id}</th><td>${escape(x.title)}<p class="small">${escape(x.note)}</p></td><td>${escape(format(x.expected))}</td><td>${escape(format(x.actual))}</td><td>${x.passed ? "PASS" : "FAIL"}</td></tr>`,
  )
  .join("");
const casesHtml = cases
  .map(
    (c) =>
      `<tr data-users="${c.users}" data-envs="${c.envs.length}" data-outcome="${c.collection}" data-pattern="${c.groupStress ? "large" : c.pattern}"><th scope="row">${c.id}</th><td>${c.users}</td><td>${c.envs.join(", ")}</td><td>${c.workspaces}</td><td>${c.forms}</td><td>${c.groupStress ? "1,000 groups" : c.pattern}</td><td>${c.approval}</td><td>${c.minimumWorkspaceUsers}</td><td>${c.expectedCollection}</td><td>${c.collection}</td><td>${c.passed ? "12/12 PASS" : "FAIL"}</td></tr>`,
  )
  .join("");
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace access | Scenario test results</title><style>*{box-sizing:border-box}body{margin:0;color:#21373e;background:#fff;font:17px/1.65 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:36px 24px 70px}h1{font-size:38px;line-height:1.2}h2{margin-top:38px;font-size:25px}a{color:#176354}p{max-width:850px}.notice{padding:16px 20px;background:#fff5e6;border-left:3px solid #9c641f}.metrics{display:flex;gap:25px;flex-wrap:wrap;margin:25px 0}.metrics div{min-width:160px}.metrics strong{font-size:29px;display:block}.small{font-size:13px;color:#52636b;margin:7px 0}.wrap{overflow:auto;border:1px solid #dce4e4;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.5;text-align:left}th,td{padding:11px 13px;vertical-align:top;border-bottom:1px solid #dce4e4}thead th{background:#f0f6f3}#matrix{min-width:1030px}.filters{display:flex;gap:16px;flex-wrap:wrap;margin:20px 0}label{font-size:13px;display:grid;gap:6px}select{font:inherit;padding:8px;background:white;border:1px solid #7c949b;border-radius:3px}a:focus-visible,select:focus-visible{outline:3px solid #bd7626;outline-offset:3px}li{max-width:900px;padding:4px 0}@media(max-width:600px){main{padding:24px 18px}h1{font-size:31px}}@media print{.filters{display:none}main{max-width:none;padding:0}.wrap{overflow:visible}table{font-size:8px}#matrix{min-width:0}}</style></head><body><main><a href="workspace-access-explainer.html">← Workspace access guide</a><h1>Scenario test cases and results</h1><p>Testing the proposed access plan across different organisation sizes, environments and access arrangements.</p><div class="notice"><strong>Model tests, not product certification.</strong> No application/API/database or performance testing is claimed. READY means the declared obligations are covered in the model. BLOCKED is often the correct result.</div><div class="metrics"><div><strong>${cases.length}</strong>configurations</div><div><strong>${result.summary.passedChecks}</strong>passing assertions</div><div><strong>${result.summary.readyConfigurations}</strong>ready configurations</div><div><strong>${result.summary.expectedBlockedConfigurations}</strong>expected refusals</div></div><p class="small">Run ${escape(result.runAt)} · commit ${escape(result.commit.slice(0, 8))} · ${escape(result.node)} · ${escape(result.platform)}</p><h2>Results by account count</h2><div class="wrap"><table><thead><tr><th>Total accounts</th><th>Configurations</th><th>Ready</th><th>Correctly blocked</th></tr></thead><tbody>${byUsers.map((x) => `<tr><th scope="row">${x.users}</th><td>${x.configurations}</td><td>${x.ready}</td><td>${x.blocked}</td></tr>`).join("")}</tbody></table></div><h2>What the combinations cover</h2><p>1, 2, 10, 100 and 1,000 total accounts; test only, prod only or dev/test/prod; one or three workspaces; one or ten forms per workspace; shared or departmental roles; approval off, prod-only or all-environment sensitivity policies. Nine additional fixtures contain 1,000 form access groups.</p><h2>How to read the results</h2><ul><li>All 12 checks must match their expected outcomes for a configuration to pass.</li><li>A solo account with approval off can cover the declared tasks. A solo account cannot supply a different independent approver.</li><li>Headcount is not authority: a department with one qualified publisher can be blocked even when the organisation has many other accounts.</li><li>Draft and collection coverage checkpoints are accepted. Approval-policy environment variants remain sensitivity assumptions; eligibility is checked for the requested protected action.</li><li>Check approval for the exact protected request; drafting has no standing two-publisher requirement (T33-T34). T15 records only an author-difference property.</li></ul><h2>Targeted cases</h2><div class="wrap"><table><thead><tr><th>ID</th><th>Scenario</th><th>Expected</th><th>Actual</th><th>Result</th></tr></thead><tbody>${targetedHtml}</tbody></table></div><h2>Full configuration matrix</h2><div class="filters"><label>Total accounts<select id="users"><option value="">Any</option>${peopleCounts.map((n) => `<option>${n}</option>`).join("")}</select></label><label>Environment count<select id="envs"><option value="">Any</option><option>1</option><option>3</option></select></label><label>Outcome<select id="outcome"><option value="">Any</option><option>READY</option><option>BLOCKED</option></select></label><label>Arrangement<select id="pattern"><option value="">Any</option><option value="shared">Shared</option><option value="departmental">Departmental</option><option value="large">1,000 groups</option></select></label></div><p id="visible" class="small" aria-live="polite"></p><div class="wrap"><table id="matrix"><thead><tr><th>ID</th><th>Users</th><th>Environments</th><th>Workspaces</th><th>Forms/WS</th><th>Arrangement</th><th>Approval variant</th><th>Min people/WS</th><th>Expected</th><th>Actual</th><th>Checks</th></tr></thead><tbody>${casesHtml}</tbody></table></div><h2>Assumptions and untested areas</h2><ul>${result.assumptions.map((x) => `<li>${escape(x)}</li>`).join("")}</ul><p>Groups-only access, whole-request pending creation, lifecycle checkpoints and account-level emergency suspension are accepted decisions. Detailed operator recovery, policy environment coverage and actual implementation remain pending. These tests do not implement those workflows or prove production scalability.</p><p><a href="workspace-access-test-cases.md">Detailed test specification</a> · <a href="workspace-access-scenario-results.json">Full JSON evidence</a> · <a href="workspace-access-scenarios.mjs">Reproducible runner</a></p></main><script>const ids=['users','envs','outcome','pattern'];const rows=[...document.querySelectorAll('#matrix tbody tr')];function filter(){let count=0;for(const row of rows){const show=ids.every(id=>!document.getElementById(id).value||row.dataset[id]===document.getElementById(id).value);row.hidden=!show;if(show)count++}document.getElementById('visible').textContent=count+' of '+rows.length+' configurations'}for(const id of ids)document.getElementById(id).addEventListener('change',filter);filter();</script></body></html>`;
writeFileSync(new URL("workspace-access-scenario-results.html", here), page);
console.log(JSON.stringify(result.summary, null, 2));
assert.equal(result.summary.failedChecks, 0, "Scenario checks failed; inspect generated evidence.");
