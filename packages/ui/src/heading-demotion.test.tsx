import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
import { withDemotedHeadings } from "./heading-demotion.ts";
import { loadGoldenForms } from "./test-support/golden.ts";

// Over the real golden corpus rather than a hand-written fixture, because the property
// worth pinning is about every document the compiler produces (ADR-18).

const forms = loadGoldenForms();

/* The first step of every golden form is the one carrying the form-title `h1`. */
const firstSteps = forms.map(({ version, form, compiled }) => ({
  label: `${version}/${form}`,
  specVersion: compiled.a2uiSpecVersion,
  document: compiled.documents[0],
}));

const SAMPLE_ROOT = firstSteps[0].document.root;

describe("withDemotedHeadings", () => {
  it("leaves the document alone at offset 0, so the portal path is untouched", () => {
    expect(withDemotedHeadings(SAMPLE_ROOT, 0)).toBe(SAMPLE_ROOT);
    expect(withDemotedHeadings(SAMPLE_ROOT, -1)).toBe(SAMPLE_ROOT);
  });

  it("never mutates the stored document (ADR-18: the compiled bytes are served forever)", () => {
    const before = JSON.stringify(SAMPLE_ROOT);
    withDemotedHeadings(SAMPLE_ROOT, 1);
    expect(JSON.stringify(SAMPLE_ROOT)).toBe(before);
  });

  it("clamps at h4, the deepest level the Text schema accepts", () => {
    // Without the clamp a twice-embedded document would emit `h5`, which the strict
    // parser rejects, turning a nesting depth into a renderer error.
    const node = { type: "Text", props: { as: "h2" }, children: "x" } as const;
    const deep = withDemotedHeadings(node, 5);
    expect(deep.props?.as).toBe("h4");
  });

  it("moves only the level, leaving the compiled typography as it is", () => {
    // An admin preview promises what a respondent saw, so restyling a heading to match
    // its new level would trade that away to fix an outline problem.
    const node = {
      type: "Text",
      props: { as: "h1", size: "2xl", weight: "bold" },
      children: "Title",
    } as const;
    const demoted = withDemotedHeadings(node, 1);
    expect(demoted.props).toEqual({ as: "h2", size: "2xl", weight: "bold" });
  });

  it("leaves non-heading Text nodes alone", () => {
    const paragraph = { type: "Text", props: { as: "p" }, children: "body" } as const;
    const bare = { type: "Text", children: "body" } as const;
    expect(withDemotedHeadings(paragraph, 1).props?.as).toBe("p");
    expect(withDemotedHeadings(bare, 1).props?.as).toBeUndefined();
  });
});

describe("A2UIStepRenderer heading levels over the golden corpus", () => {
  it.each(firstSteps)(
    "$label renders exactly one h1 when it is the page (the portal path)",
    ({ document, specVersion }) => {
      const { container } = render(
        <A2UIStepRenderer document={document} specVersion={specVersion} />,
      );
      expect(container.querySelectorAll("h1")).toHaveLength(1);
    },
  );

  it.each(firstSteps)(
    "$label renders no h1 at all when embedded, so the host page owns the outline",
    ({ document, specVersion }) => {
      const { container } = render(
        <A2UIStepRenderer document={document} specVersion={specVersion} headingLevelOffset={1} />,
      );
      expect(container.querySelectorAll("h1")).toHaveLength(0);
      expect(container.querySelectorAll("h2").length).toBeGreaterThan(0);
    },
  );

  it.each(firstSteps)(
    "$label keeps the same heading text, in the same order, when embedded",
    ({ document, specVersion }) => {
      const read = (offset: number) => {
        const { container } = render(
          <A2UIStepRenderer
            document={document}
            specVersion={specVersion}
            headingLevelOffset={offset}
          />,
        );
        return [...container.querySelectorAll("h1, h2, h3, h4")].map((el) => el.textContent);
      };
      expect(read(1)).toEqual(read(0));
    },
  );
});
