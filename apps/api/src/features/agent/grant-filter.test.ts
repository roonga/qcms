import { describe, expect, it } from "vitest";

import type { HeldGrant } from "../membership/policy.js";
import { offeredActionKinds, offeredEnvironments, offersNoAction } from "./grant-filter.js";
import type { ScreenId } from "./screens.js";

const ENVIRONMENTS = ["test", "prod"] as const;

function filterFor(args: {
  readonly memberRole?: string | undefined;
  readonly grants?: readonly HeldGrant[];
  readonly current?: string;
}) {
  return offeredActionKinds({
    memberRole: args.memberRole,
    grants: args.grants ?? [],
    environments: [...ENVIRONMENTS],
    current: args.current ?? "test",
    formId: "frm_a",
  });
}

const editorIn = (environments: readonly string[]): HeldGrant => ({
  role: "forms.editor",
  environments: [...environments],
  forms: ["all"],
});

/** ADR-41's production split: a control-plane write in `prod` is the approver's. */
const approverIn = (environments: readonly string[]): HeldGrant => ({
  role: "forms.approver",
  environments: [...environments],
  forms: ["all"],
});

describe("the grant filter (section 6.1, criterion 3)", () => {
  it("offers a `forms.viewer` no action kind on any screen", () => {
    const offered = filterFor({
      grants: [{ role: "forms.viewer", environments: ["all"], forms: ["all"] }],
    });
    expect(offered).toEqual([]);
    expect(offersNoAction(offered)).toBe(true);
  });

  it("offers an account with no grant at all nothing", () => {
    expect(filterFor({})).toEqual([]);
  });

  it("narrows an argument-environment kind to the environments the caller holds", () => {
    const offered = filterFor({ grants: [editorIn(["test"])], current: "test" });
    expect(offeredEnvironments(offered, "form.release")).toEqual(["test"]);
  });

  it("offers an editor scoped to every environment no production release at all", () => {
    // ADR-41's production split, unchanged: the environment enum carries no `prod` even
    // though the grant's own scope does (criterion 3).
    const offered = filterFor({ grants: [editorIn(["all"])], current: "test" });
    expect(offeredEnvironments(offered, "form.release")).toEqual(["test"]);
  });

  it("offers a production release to the approver the split gives it to", () => {
    const offered = filterFor({ grants: [approverIn(["test", "prod"])], current: "test" });
    expect([...offeredEnvironments(offered, "form.release")].sort()).toEqual(["prod", "test"]);
  });

  it("binds a switcher-environment kind to the current environment alone", () => {
    const onTest = filterFor({ grants: [editorIn(["test", "prod"])], current: "test" });
    expect(offeredEnvironments(onTest, "link.mint")).toEqual(["test"]);
    const onProd = filterFor({ grants: [approverIn(["test", "prod"])], current: "prod" });
    expect(offeredEnvironments(onProd, "link.mint")).toEqual(["prod"]);
  });

  it("drops a switcher kind entirely when the caller lacks the cell in that environment", () => {
    const offered = filterFor({ grants: [editorIn(["test"])], current: "prod" });
    expect(offeredEnvironments(offered, "link.mint")).toEqual([]);
    expect(offered.some((entry) => entry.kind === "link.mint")).toBe(false);
  });
});

describe("the kinds a screen offers", () => {
  function onScreen(screen: ScreenId, grants: readonly HeldGrant[]) {
    return offeredActionKinds({
      memberRole: undefined,
      grants,
      environments: [...ENVIRONMENTS],
      current: "test",
      screen,
      formId: "frm_a",
    });
  }

  const kindsOn = (screen: ScreenId, grants: readonly HeldGrant[]) =>
    onScreen(screen, grants).map((entry) => entry.kind);

  it("offers the whole form subtree's kinds from any form-scoped screen", () => {
    // Both roles, because publishing is the editor's cell and a production release is the
    // approver's.
    const approver = [editorIn(["test", "prod"]), approverIn(["test", "prod"])];
    const subtree = ["form.publish", "form.release", "link.mint", "link.revoke"];
    expect(kindsOn("/forms/[formId]/links", approver)).toEqual(subtree);
    expect(kindsOn("/forms/[formId]/responses", approver)).toEqual(subtree);
    expect(kindsOn("/forms/[formId]", approver)).toEqual(subtree);
  });

  it("still cuts the subtree's kinds to the pairs the caller holds", () => {
    const viewer: readonly HeldGrant[] = [
      { role: "forms.viewer", environments: ["all"], forms: ["all"] },
    ];
    expect(kindsOn("/forms/[formId]/links", viewer)).toEqual([]);
    const editor = onScreen("/forms/[formId]/responses", [editorIn(["test"])]);
    expect(offeredEnvironments(editor, "form.release")).toEqual(["test"]);
    expect(editor.map((entry) => entry.kind)).toContain("link.mint");
  });

  it("offers a screen outside a form subtree nothing of the subtree's", () => {
    const approver = [editorIn(["test", "prod"]), approverIn(["test", "prod"])];
    expect(kindsOn("/operations", approver)).toEqual([]);
    expect(kindsOn("/forms", approver)).toEqual([]);
  });
});
