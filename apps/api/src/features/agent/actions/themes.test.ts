import { describe, expect, it } from "vitest";

import { BUILDER_SCREEN } from "../edit-token.js";
import { offeredActionKinds } from "../grant-filter.js";
import type { HeldGrant } from "../../membership/policy.js";
import { actionKind } from "./registry.js";

/**
 * The two theme kinds on the half the type system cannot state: that no proposal can name an
 * address, that the look a save keeps is nobody's argument, and that reading themes is the
 * editor's cell rather than a viewer's.
 */

const EDITOR: HeldGrant = { roles: ["forms.editor"], environments: ["test", "prod"] };
const VIEWER: HeldGrant = { roles: ["forms.viewer"], environments: ["test", "prod"] };

function offeredOnBuilder(grant: HeldGrant): readonly string[] {
  return offeredActionKinds({
    memberRole: undefined,
    grants: [grant],
    environments: ["test", "prod"],
    current: "test",
    screen: BUILDER_SCREEN,
  }).map((entry) => entry.kind);
}

describe("theme.derive (SEC-18 W2)", () => {
  const derive = actionKind("theme.derive");

  it("accepts no address from a proposal, under any member name", () => {
    expect(derive?.args.safeParse({ workspaceId: "org_a" }).success).toBe(true);
    for (const member of ["url", "address", "href", "site"]) {
      expect(
        derive?.args.safeParse({ workspaceId: "org_a", [member]: "https://brand.example/" })
          .success,
        member,
      ).toBe(false);
    }
  });

  it("asks the user to type the address on the card, which carries no token", () => {
    expect(derive?.card.typedInput).toBe("url");
    expect(derive?.handOff).toBe(true);
    expect(derive?.route).toBeUndefined();
    expect(derive?.argsFrom).toBeUndefined();
  });

  it("reports no colour, face or logo back to the model as a step result", () => {
    expect(derive?.resultAllowlist).toEqual(["workspaceId"]);
  });
});

describe("theme.save", () => {
  const save = actionKind("theme.save");

  it("hands off to the drawer, which is where the look being kept lives", () => {
    expect(save?.handOff).toBe(true);
    expect(save?.card.headingControl).toBe("appearance.themeSave");
  });

  it("names the theme and nothing of the look, which is the drawer's own state", () => {
    expect(Object.keys((save?.args as unknown as { shape: object }).shape).sort()).toEqual([
      "name",
      "workspaceId",
    ]);
    for (const named of ["palettes", "face", "corners", "pageTint", "logoKey", "sourceHost"]) {
      expect(
        save?.args.safeParse({ workspaceId: "org_a", name: "Harbour", [named]: {} }).success,
        named,
      ).toBe(false);
    }
  });

  it("carries the name the card showed back as the step's own, and nothing else", () => {
    expect(
      save?.recomputeArgs({
        path: "",
        method: "POST",
        params: { id: "org_a" },
        body: { name: "Bright Start", palettes: { light: {} } },
        environment: "test",
      }),
    ).toEqual({});
  });
});

describe("who the builder offers them to", () => {
  it("offers both to an Edit forms holder and neither to a View forms holder", () => {
    expect(offeredOnBuilder(EDITOR)).toContain("theme.derive");
    expect(offeredOnBuilder(EDITOR)).toContain("theme.save");
    expect(offeredOnBuilder(VIEWER)).toEqual([]);
  });

  it("offers neither off the builder, where the appearance drawer is not mounted", () => {
    const elsewhere = offeredActionKinds({
      memberRole: undefined,
      grants: [EDITOR],
      environments: ["test", "prod"],
      current: "test",
      screen: "/forms/[formId]",
    }).map((entry) => entry.kind);
    expect(elsewhere).not.toContain("theme.derive");
    expect(elsewhere).not.toContain("theme.save");
  });
});
