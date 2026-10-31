import { describe, expect, it } from "vitest";

import { policyForRequest } from "../../membership/route-policy.js";
import { SCREEN_IDS } from "../screens.js";
import {
  createQuestion,
  deprecateQuestionVersion,
  newQuestionVersion,
  publishQuestionVersion,
  saveQuestionDraft,
} from "./questions.js";
import type { ActionKindDef, ActionRequestFacts, ActionRoute } from "./types.js";

/**
 * D6's five kinds. The two properties every kind has, plus the two this group adds: a
 * definition travels in the arguments and is therefore bound by the digest, and the two
 * create-shaped kinds return the value a later step may reference.
 */

const DEFS: readonly ActionKindDef[] = [
  createQuestion,
  saveQuestionDraft,
  publishQuestionVersion,
  deprecateQuestionVersion,
  newQuestionVersion,
];

const DEFINITION = { questionId: "q_colour", type: "shortText", label: { en: "Colour" } };

function routeOf(def: ActionKindDef): ActionRoute {
  const route = def.route;
  if (route === undefined) throw new Error(`${def.kind} declares no route`);
  return route;
}

function factsFor(def: ActionKindDef, body: unknown): ActionRequestFacts {
  return {
    path: routeOf(def).path,
    method: routeOf(def).method,
    params: { id: "q_colour", v: "2" },
    body,
    environment: "test",
  };
}

describe("D6's action kinds", () => {
  it("names a route the policy table authorises, with the same cell", () => {
    for (const def of DEFS) {
      const policy = policyForRequest(routeOf(def).method, routeOf(def).path);
      expect(policy?.path, def.kind).toBe(routeOf(def).path);
      expect({ resource: policy?.resource, action: policy?.action }, def.kind).toEqual(def.cell);
    }
  });

  it("acts in no environment of its own, so the switcher's is what a step binds", () => {
    for (const def of DEFS) {
      expect(def.environmentFrom, def.kind).toBe("switcher");
      expect(def.environmentArgument, def.kind).toBeUndefined();
      expect(
        policyForRequest(routeOf(def).method, routeOf(def).path)?.environmentFrom,
        def.kind,
      ).toBeUndefined();
    }
  });

  it("sits on a library screen and names a heading-row control", () => {
    expect(createQuestion.screen).toBe("/questions");
    expect(createQuestion.card.headingControl).toBe("questions.create");
    for (const def of [
      saveQuestionDraft,
      publishQuestionVersion,
      deprecateQuestionVersion,
      newQuestionVersion,
    ]) {
      expect(def.screen, def.kind).toBe("/questions/[questionId]");
      expect(def.card.headingControl, def.kind).not.toBeUndefined();
    }
  });

  it("recomputes a create from the body, with the optional workspace carried", () => {
    expect(
      createQuestion.recomputeArgs(
        factsFor(createQuestion, { slug: "colour", definition: DEFINITION }),
      ),
    ).toEqual({ slug: "colour", definition: DEFINITION });
    expect(
      createQuestion.recomputeArgs(
        factsFor(createQuestion, {
          slug: "colour",
          definition: DEFINITION,
          workspaceId: "wsp_a",
        }),
      ),
    ).toEqual({ slug: "colour", definition: DEFINITION, workspaceId: "wsp_a" });
  });

  it("recomputes a save from the path's version and the body's definition", () => {
    expect(
      saveQuestionDraft.recomputeArgs(factsFor(saveQuestionDraft, { definition: DEFINITION })),
    ).toEqual({ questionId: "q_colour", version: 2, definition: DEFINITION });
  });

  it("recomputes the version acts from the path alone, with the version as a number", () => {
    for (const def of [publishQuestionVersion, deprecateQuestionVersion]) {
      expect(def.recomputeArgs(factsFor(def, undefined)), def.kind).toEqual({
        questionId: "q_colour",
        version: 2,
      });
    }
    expect(newQuestionVersion.recomputeArgs(factsFor(newQuestionVersion, undefined))).toEqual({
      questionId: "q_colour",
    });
  });

  it("refuses an argument set with an unknown member or a version that is not a whole number", () => {
    expect(publishQuestionVersion.args.safeParse({ questionId: "q_colour" }).success).toBe(false);
    expect(
      publishQuestionVersion.args.safeParse({ questionId: "q_colour", version: 1.5 }).success,
    ).toBe(false);
    expect(
      publishQuestionVersion.args.safeParse({ questionId: "q_colour", version: 1, other: true })
        .success,
    ).toBe(false);
    expect(
      saveQuestionDraft.args.safeParse({ questionId: "q_colour", version: 1, definition: "{}" })
        .success,
    ).toBe(false);
  });

  it("binds the definition in the arguments, so what the card showed is what runs", () => {
    const members = Object.keys(
      (saveQuestionDraft.args as unknown as { shape: Record<string, unknown> }).shape,
    );
    expect(members).toContain("definition");
  });

  it("links what a create made at a page route, and references a field it allowlists", () => {
    for (const def of [createQuestion, newQuestionVersion]) {
      const link = def.card.createdLink;
      expect(link?.screen, def.kind).toBe("/questions/[questionId]");
      expect(SCREEN_IDS, def.kind).toContain(link?.screen);
      expect(def.resultAllowlist, def.kind).toContain(link?.field);
    }
    expect(createQuestion.references).toEqual(["questionId"]);
    expect(newQuestionVersion.references).toEqual(["version"]);
  });

  it("allowlists no definition and no label back to the model", () => {
    for (const def of DEFS) {
      expect(def.resultAllowlist, def.kind).not.toContain("definition");
      expect(def.resultAllowlist, def.kind).not.toContain("label");
    }
  });
});
