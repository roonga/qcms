import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
import { withDemotedHeadings } from "./heading-demotion.ts";
import { loadGoldenForms } from "./test-support/golden.ts";

/**
 * Heading demotion for an embedded document (issue #537).
 *
 * The defect: `/forms/{id}/versions/{v}` rendered two `<h1>`s, its own naming the version
 * and the stored document's naming the form, because a compiled step carries the page
 * outline it would have on the portal. Two top-level headings on one page is a
 * document-outline defect and makes `getByRole("heading", { level: 1 })` ambiguous on the
 * route - which is how it surfaced, as a Playwright strict-mode violation rather than by
 * inspection.
 *
 * These run at the unit and conformance layer deliberately, over the REAL golden corpus
 * rather than a hand-written fixture: the corpus is the renderer's conformance input
 * (ADR-18), and the property worth pinning is about every document the compiler produces,
 * not about one shape a test author chose. A browser assertion would only re-observe what
 * the DOM here already says.
 */

const forms = loadGoldenForms();

/** The first step of every golden form: the one carrying the form-title `h1`. */
const firstSteps = forms.map(({ version, form, compiled }) => ({
  label: `${version}/${form}`,
  specVersion: compiled.a2uiSpecVersion,
  document: compiled.documents[0],
}));

/** One real compiled root, for the assertions that are about the function, not the corpus. */
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
    // Without the clamp a twice-embedded document would emit `h5`, which `@a2ra/core`'s
    // strict parser rejects: a nesting depth would turn into a renderer error rather than
    // a slightly flat outline.
    const node = { type: "Text", props: { as: "h2" }, children: "x" } as const;
    const deep = withDemotedHeadings(node, 5);
    expect(deep.props?.as).toBe("h4");
  });

  it("moves only the level, leaving the compiled typography as it is", () => {
    // Preview fidelity is the reason. An admin preview promises "this is what a respondent
    // saw", so restyling a heading to match its new level would trade that away to fix an
    // outline problem, which is not the problem.
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
      // The assertion #537 is about. The host route keeps its own `h1` (issue #510 made it
      // name the version, which is the page's real subject) and the embedded document's
      // headings start one level down.
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
      // Demotion is a renumbering, not an edit. If a heading's text moved or a heading
      // went missing, the preview would stop being a faithful record of the document.
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
