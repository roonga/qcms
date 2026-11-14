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
  });
}

/** View forms and Edit forms ignore the environment set, so the group names none. */
const editor: HeldGrant = { roles: ["forms.editor"], environments: [] };

const viewer: HeldGrant = { roles: ["forms.viewer"], environments: [] };

const publisherIn = (environments: readonly string[]): HeldGrant => ({
  roles: ["forms.publisher"],
  environments: [...environments],
});

describe("the grant filter (section 6.1, criterion 3)", () => {
  it("offers a `forms.viewer` no action kind on any screen", () => {
    const offered = filterFor({ grants: [viewer] });
    expect(offered).toEqual([]);
    expect(offersNoAction(offered)).toBe(true);
  });

  it("offers an account with no grant at all nothing", () => {
    expect(filterFor({})).toEqual([]);
  });

  it("narrows an argument-environment kind to the environments the caller holds", () => {
    const offered = filterFor({ grants: [publisherIn(["test"])], current: "test" });
    expect(offeredEnvironments(offered, "form.release")).toEqual(["test"]);
  });

  it("offers an editor who holds no publisher group no release at all", () => {
    const offered = filterFor({ grants: [editor], current: "test" });
    expect(offeredEnvironments(offered, "form.release")).toEqual([]);
    expect(offered.some((entry) => entry.kind === "form.release")).toBe(false);
  });

  it("offers a release in every environment the publisher's groups name", () => {
    const offered = filterFor({ grants: [publisherIn(["test", "prod"])], current: "test" });
    expect([...offeredEnvironments(offered, "form.release")].sort()).toEqual(["prod", "test"]);
  });

  it("binds a switcher-environment kind to the current environment alone", () => {
    const onTest = filterFor({ grants: [publisherIn(["test", "prod"])], current: "test" });
    expect(offeredEnvironments(onTest, "link.mint")).toEqual(["test"]);
    const onProd = filterFor({ grants: [publisherIn(["test", "prod"])], current: "prod" });
    expect(offeredEnvironments(onProd, "link.mint")).toEqual(["prod"]);
  });

  it("drops a switcher kind entirely when the caller lacks the cell in that environment", () => {
    const offered = filterFor({ grants: [publisherIn(["test"])], current: "prod" });
    expect(offeredEnvironments(offered, "link.mint")).toEqual([]);
    expect(offered.some((entry) => entry.kind === "link.mint")).toBe(false);
  });
});

describe("the kinds a caller is offered, whatever screen the turn is on", () => {
  function onScreen(screen: ScreenId, grants: readonly HeldGrant[]) {
    return offeredActionKinds({
      memberRole: undefined,
      grants,
      environments: [...ENVIRONMENTS],
      current: "test",
      screen,
    });
  }

  const kindsOn = (screen: ScreenId, grants: readonly HeldGrant[]) =>
    onScreen(screen, grants).map((entry) => entry.kind);

  // Both roles, because drafting is the editor's cell and publishing is the publisher's.
  const author = () => [editor, publisherIn(["test", "prod"])];

  it("offers the same kinds from a screen in a form subtree and from one outside it", () => {
    const fromBuilder = kindsOn("/forms/[formId]", author());
    const fromList = kindsOn("/forms", author());
    // `apply-draft` is the one exception: the builder runs it through its own save.
    expect(fromBuilder).toContain("apply-draft");
    expect(fromList).not.toContain("apply-draft");
    expect(fromBuilder.filter((kind) => kind !== "apply-draft")).toEqual(fromList);
  });

  it("offers an operational kind from an authoring screen, and the reverse", () => {
    expect(kindsOn("/forms", author())).toContain("link.mint");
    expect(kindsOn("/forms", author())).toContain("webhook.retarget");
    expect(kindsOn("/operations/forms/[formId]/links", author())).toContain("form.publish");
    expect(kindsOn("/settings", author())).toContain("form.create");
  });

  it("offers a local kind on its own screen alone, since only that screen can run it", () => {
    for (const screen of ["/forms", "/forms/[formId]/rules", "/questions", "/settings"] as const) {
      expect(kindsOn(screen, author()), screen).not.toContain("apply-draft");
    }
    expect(kindsOn("/forms/[formId]", author())).toContain("apply-draft");
  });

  // The data family is separate and neither implies the other (ADR-41), so the response
  // kinds appear for an eraser and not for an authoring role however widely it is scoped.
  it("offers the response kinds to an eraser and to no authoring role", () => {
    const eraser: readonly HeldGrant[] = [
      { roles: ["responses.eraser"], environments: ["test", "prod"] },
    ];
    const kinds = kindsOn("/operations/forms/[formId]/responses/[sessionId]", eraser);
    expect(kinds).toContain("response.erase");
    expect(kinds).toContain("response.unflag");
    expect(kindsOn("/forms", [editor])).not.toContain("response.erase");
  });

  it("still cuts every kind to the pairs the caller holds", () => {
    expect(kindsOn("/operations/forms/[formId]/links", [viewer])).toEqual([]);
    expect(kindsOn("/forms/[formId]", [viewer])).toEqual([]);
    const publisher = onScreen("/forms", [publisherIn(["test"])]);
    expect(offeredEnvironments(publisher, "link.mint")).toEqual(["test"]);
    // Publishing to `prod` needs a group naming `prod`, so a publisher for `test` is
    // offered the kind in `test` alone.
    expect(offeredEnvironments(publisher, "form.release")).toEqual(["test"]);
  });

  it("offers an environment-scoped kind away from one form's own screen", () => {
    const eraser: readonly HeldGrant[] = [
      { roles: ["responses.eraser"], environments: ["test", "prod"] },
    ];
    expect(
      offeredActionKinds({
        memberRole: undefined,
        grants: eraser,
        environments: [...ENVIRONMENTS],
        current: "test",
        screen: "/responses",
      }).map((entry) => entry.kind),
    ).toContain("response.erase");
  });

  it("offers no environment-scoped kind in an environment no group of the caller's names", () => {
    const eraser: readonly HeldGrant[] = [{ roles: ["responses.eraser"], environments: ["test"] }];
    const offered = offeredActionKinds({
      memberRole: undefined,
      grants: eraser,
      environments: [...ENVIRONMENTS],
      current: "prod",
      screen: "/responses",
    });
    expect(offeredEnvironments(offered, "response.erase")).toEqual([]);
  });

  it("offers a stored role name no declared role covers nothing at all", () => {
    const unknown: readonly HeldGrant[] = [
      { roles: ["forms.approver"], environments: ["test", "prod"] },
    ];
    expect(kindsOn("/forms/[formId]", unknown)).toEqual([]);
  });
});
