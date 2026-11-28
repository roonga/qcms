import { describe, expect, it } from "vitest";

import { loadConfig } from "../../../config.js";
import { validEnv } from "../../../test-support.js";
import { BUILDER_SCREEN } from "../edit-token.js";
import { enabledActionKindFlags, offeredActionKinds } from "../grant-filter.js";
import type { ActionKindFlag } from "./types.js";
import type { HeldGrant } from "../../membership/policy.js";
import { actionKind } from "./registry.js";

/**
 * The two theme kinds on the half the type system cannot state: that no proposal can name an
 * address, that the look a save keeps is nobody's argument, and that reading themes is the
 * editor's cell rather than a viewer's.
 */

const EDITOR: HeldGrant = { roles: ["forms.editor"], environments: ["test", "prod"] };
const VIEWER: HeldGrant = { roles: ["forms.viewer"], environments: ["test", "prod"] };

function offeredOnBuilder(
  grant: HeldGrant,
  enabledFlags: readonly ActionKindFlag[] = ["themeDerive"],
): readonly string[] {
  return offeredActionKinds({
    memberRole: undefined,
    grants: [grant],
    environments: ["test", "prod"],
    current: "test",
    screen: BUILDER_SCREEN,
    enabledFlags,
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

  it("carries nothing back as the step's own, not even the name the card showed", () => {
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
      enabledFlags: ["themeDerive"],
    }).map((entry) => entry.kind);
    expect(elsewhere).not.toContain("theme.derive");
    expect(elsewhere).not.toContain("theme.save");
  });
});

/**
 * SEC-18 S1 at the model-facing end: an act the deployment has no route for is offered to
 * nobody, so the builder never puts up a card the appearance drawer has no row to finish.
 */
describe("the derive flag decides whether the kind is offered at all", () => {
  it("reads the flag off the deployment configuration, in both states", () => {
    const off = loadConfig(validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake" }));
    expect(off.flags.themeDerive).toBe("off");
    expect(enabledActionKindFlags(off.flags)).toEqual([]);

    const on = loadConfig(
      validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake", QCMS_FLAG_THEME_DERIVE: "on" }),
    );
    expect(enabledActionKindFlags(on.flags)).toEqual(["themeDerive"]);
  });

  it("withholds theme.derive with the flag off and keeps every other builder kind", () => {
    const off = offeredOnBuilder(EDITOR, []);
    expect(off).not.toContain("theme.derive");
    expect(off).toContain("theme.save");
    expect(off).toContain("question.create");
  });

  it("offers it with the flag on", () => {
    expect(offeredOnBuilder(EDITOR, ["themeDerive"])).toContain("theme.derive");
  });

  it("names the flag on the kind, so nothing has to hold a second list", () => {
    expect(actionKind("theme.derive")?.flag).toBe("themeDerive");
    expect(actionKind("theme.save")?.flag).toBeUndefined();
  });
});
