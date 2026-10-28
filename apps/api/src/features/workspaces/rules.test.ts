import { describe, expect, it } from "vitest";

import type { QuestionOwnership } from "@roonga/qcms-db";
import type { QuestionId } from "@roonga/qcms-core";

import {
  WORKSPACE_SLUG_MAX_LENGTH,
  isWorkspaceSlug,
  mayEditQuestion,
  mayPinQuestion,
} from "./rules.js";

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
    // A dot would collide with ADR-41's dotted access-group grammar.
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
    // An access group joins a set of environments with hyphens, so a hyphen inside an
    // environment name would make the set unparseable; a workspace slug is in no such
    // derived identifier.
    expect(isWorkspaceSlug("dev-test")).toBe(true);
  });

  it("bounds the length", () => {
    expect(isWorkspaceSlug("a".repeat(WORKSPACE_SLUG_MAX_LENGTH))).toBe(true);
    expect(isWorkspaceSlug("a".repeat(WORKSPACE_SLUG_MAX_LENGTH + 1))).toBe(false);
  });
});
