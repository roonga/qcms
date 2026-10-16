import { describe, expect, it } from "vitest";

import type { QuestionOwnership } from "@roonga/qcms-db";
import type { QuestionId } from "@roonga/qcms-core";

import {
  WORKSPACE_SLUG_MAX_LENGTH,
  isWorkspaceSlug,
  mayEditQuestion,
  mayPinQuestion,
} from "./rules.js";

/**
 * The workspace rules, as units (ADR-41, task 068).
 *
 * Exit criterion 6 is asserted **on both halves** here: an editor outside the shared
 * workspace can pin a shared question and cannot edit one. The pin half is also asserted
 * end to end through publish, in `apps/api/src/features/forms/forms.integration.test.ts`,
 * because that is where the grandfathering lives; the edit half has no route of its own
 * until task 069 resolves the caller's workspace, which is why it is pinned here as a
 * rule rather than left to that task to decide again.
 */

const ownership = (workspaceId: string, workspaceIsShared: boolean): QuestionOwnership => ({
  questionId: "q_dob" as QuestionId,
  workspaceId,
  workspaceIsShared,
});

describe("mayPinQuestion", () => {
  it("allows a question the form's own workspace owns", () => {
    expect(
      mayPinQuestion({ formWorkspaceId: "org_home", question: ownership("org_home", false) }),
    ).toBe(true);
  });

  it("allows a shared-workspace question from any workspace (finding 10)", () => {
    // The library case: every workspace's editors see and may pin its questions, which is
    // what lets one organisation keep a single canonical "date of birth".
    expect(
      mayPinQuestion({ formWorkspaceId: "org_vehicle", question: ownership("org_lib", true) }),
    ).toBe(true);
  });

  it("refuses a question another ordinary workspace owns (criterion 2, Q14)", () => {
    expect(
      mayPinQuestion({ formWorkspaceId: "org_vehicle", question: ownership("org_home", false) }),
    ).toBe(false);
  });

  it("is a fact about two rows, so the shared flag alone decides the cross-workspace case", () => {
    // Same question id, same form workspace, one bit different: nothing about the caller
    // enters this rule, which is why it holds for the installation administrator too.
    const question = ownership("org_home", false);
    expect(mayPinQuestion({ formWorkspaceId: "org_vehicle", question })).toBe(false);
    expect(
      mayPinQuestion({
        formWorkspaceId: "org_vehicle",
        question: { ...question, workspaceIsShared: true },
      }),
    ).toBe(true);
  });
});

describe("mayEditQuestion", () => {
  it("allows the owning workspace's own editors", () => {
    expect(mayEditQuestion({ actorWorkspaceId: "org_home", questionWorkspaceId: "org_home" })).toBe(
      true,
    );
  });

  it("refuses an editor outside the workspace that owns the question", () => {
    expect(
      mayEditQuestion({ actorWorkspaceId: "org_vehicle", questionWorkspaceId: "org_home" }),
    ).toBe(false);
  });

  it("refuses an editor outside the SHARED workspace, which is the half that surprises", () => {
    // The asymmetry finding 10 asks for, stated as a test: being able to pin a shared
    // question says nothing about being able to change its wording. A library three
    // groups can edit is not a library.
    const library = "org_lib";
    expect(mayEditQuestion({ actorWorkspaceId: "org_home", questionWorkspaceId: library })).toBe(
      false,
    );
    expect(
      mayPinQuestion({ formWorkspaceId: "org_home", question: ownership(library, true) }),
    ).toBe(true);
  });
});

describe("isWorkspaceSlug", () => {
  it("accepts lowercase letters, digits and interior hyphens", () => {
    for (const slug of ["default", "hr", "home-insurance", "team2", "a1-b2-c3"]) {
      expect(isWorkspaceSlug(slug)).toBe(true);
    }
  });

  it("refuses what the access-group name and the display would make ambiguous", () => {
    // A dot would collide with ADR-41's dotted access-group grammar; an underscore,
    // uppercase, spaces and edge hyphens are refused for legibility. Emptiness is
    // refused because a slug is how a human names the workspace.
    for (const slug of [
      "",
      "HR",
      "two words",
      "under_score",
      "dot.ted",
      "-lead",
      "trail-",
      "a--b",
    ]) {
      expect(isWorkspaceSlug(slug)).toBe(false);
    }
  });

  it("is not the environment rule, which forbids a hyphen outright (Q42)", () => {
    // `dev-test` is a legal workspace slug and an illegal environment name: an access
    // group joins a SET of environments with hyphens, so a hyphen inside one environment
    // name would make the set unparseable. A workspace slug is in no derived identifier.
    expect(isWorkspaceSlug("dev-test")).toBe(true);
  });

  it("bounds the length", () => {
    expect(isWorkspaceSlug("a".repeat(WORKSPACE_SLUG_MAX_LENGTH))).toBe(true);
    expect(isWorkspaceSlug("a".repeat(WORKSPACE_SLUG_MAX_LENGTH + 1))).toBe(false);
  });
});
