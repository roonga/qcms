import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  QuestionDefinitionView,
  QuestionStatus,
  QuestionVersion,
} from "../../lib/questions/types.ts";
import { QuestionFacts } from "./question-facts.tsx";

const DEFINITION = {
  type: "number",
  label: { en: "How many?" },
  required: true,
} as unknown as QuestionDefinitionView;

function version(n: number, status: QuestionStatus): QuestionVersion {
  return {
    version: n,
    status,
    definition: DEFINITION,
    publishedAt: status === "draft" ? null : "2026-05-14T09:00:00.000Z",
  } as unknown as QuestionVersion;
}

function facts(versions: readonly QuestionVersion[], selected: number): HTMLElement {
  const { getByTestId } = render(
    <QuestionFacts
      slug="smoking-status"
      createdAt="2025-06-01T09:00:00.000Z"
      versions={versions}
      selected={selected}
    />,
  );
  return getByTestId("qcms-question-facts");
}

describe("the question's own facts, in the page body", () => {
  it("states the slug, the created day and the locked type", () => {
    const text = facts([version(1, "published")], 1).textContent ?? "";
    expect(text).toContain("Slug");
    expect(text).toContain("smoking-status");
    expect(text).toContain("Created");
    expect(text).toContain("Type");
    expect(text).toContain("Number");
    expect(text).not.toContain("locked");
  });

  it("digests the versions: how many, and which one is live", () => {
    const el = facts([version(1, "deprecated"), version(2, "published"), version(3, "draft")], 3);
    expect(el.textContent).toContain("3 versions, v2 published");
  });

  it("says so plainly when nothing has been published, in the singular where it applies", () => {
    expect(facts([version(1, "draft")], 1).textContent).toContain("1 version, none published");
  });
});
