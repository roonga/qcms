import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FormVersionSnapshot } from "../../lib/forms/types.ts";

/**
 * Issue #537: a page that embeds a compiled A2UI document has exactly one `<h1>`, its own.
 *
 * `/forms/{id}/versions/{v}` had two. The route's own heading names the version (issue
 * #510 made it do that, because the version is the page's subject), and the stored
 * document supplies a second one naming the form, because a compiled step carries the
 * outline it would have as a whole page on the portal: a form-title `h1` on the first
 * step, a step-title `h2` on every step. Two top-level headings on one page is a
 * document-outline defect - a screen-reader user navigating by heading level gets two
 * competing answers to "what is this page" - and it makes `getByRole("heading", { level: 1 })`
 * ambiguous on the route, which is how it surfaced: a Playwright strict-mode violation
 * while proving #510, not an inspection finding.
 *
 * ## Which side yields, and where the fix lives
 *
 * The renderer's, not the chrome's. The compiled document is stored, immutable content
 * served for the life of the snapshot (R1, ADR-18) and cannot know what page it will be
 * shown inside; the page is the only party that can know. So `@qcms/ui`'s
 * `A2UIStepRenderer` grew a `headingLevelOffset`, applied at render time exactly as
 * `withNativeSubmit` and `documentForVisible` already shape the tree without touching the
 * stored bytes, and the three embedding surfaces pass `1`.
 *
 * ## What each layer proves
 *
 * `packages/ui/src/heading-demotion.test.tsx` carries the property over the whole golden
 * corpus: every compiled first step renders one `h1` unembedded and none embedded, with
 * the same heading text in the same order either way. That is the general claim, made
 * where the corpus lives.
 *
 * This file makes the local one: the admin's version view actually passes the offset, so
 * this route cannot regress by dropping a prop while the renderer stays correct. It reads
 * the real `VersionView` against a document shaped like a compiled step, at the
 * `renderToStaticMarkup` layer the app's other server-render assertions use.
 *
 * No browser assertion is needed for either. The claim is about which elements the DOM
 * contains, and a static render answers it exactly.
 */

// The real renderer: this file is about what `A2UIStepRenderer` emits for an embedded
// document, so a stub would assert nothing at all.
vi.mock("@/components/kit", () => import("../../components/kit.tsx"));
vi.mock("@/components/preview-theme-island", () =>
  import("../../components/preview-theme-island.tsx"),
);
vi.mock("@/lib/i18n/en", () => import("../../lib/i18n/en.ts"));
vi.mock("@/lib/page-headings", () => import("../../lib/page-headings.ts"));
vi.mock("@/lib/preview-theme", () => import("../../lib/preview-theme.ts"));

const { VersionView } = await import("../../components/forms/version-view.tsx");

/**
 * One step shaped exactly as the compiler emits a first step: `Form -> Flex(column)` over
 * the form-title `h1`, the step-title `h2`, and the step's content. Hand-written rather
 * than read from the golden corpus because the corpus is two packages away and the claim
 * here is only "the offset reaches the renderer"; the corpus-wide claim is made in
 * `@qcms/ui`, against the real bytes.
 */
const FIRST_STEP = {
  stepId: "step_1",
  root: {
    type: "Form",
    children: [
      {
        type: "Flex",
        props: { direction: "column", gap: "md" },
        children: [
          { type: "Text", props: { as: "h1" }, children: "Life insurance" },
          { type: "Text", props: { as: "h2" }, children: "About you" },
        ],
      },
    ],
  },
};

const SNAPSHOT = {
  formId: "frm_life_insurance",
  version: 3,
  publishedAt: "2026-01-01T00:00:00.000Z",
  compilerVersion: "0.1.0",
  a2uiSpecVersion: "1.0.0",
  semanticsVersion: "1",
  definition: {},
  documents: [FIRST_STEP],
} as unknown as FormVersionSnapshot;

describe("the version view embeds the stored document without claiming the page", () => {
  const markup = renderToStaticMarkup(<VersionView snapshot={SNAPSHOT} defaultTheme="slate" />);

  it("renders no <h1>, so the route's own heading is the page's only one", () => {
    expect(markup).not.toMatch(/<h1[\s>]/u);
  });

  it("still renders the document's headings, one level down", () => {
    // Demotion is a renumbering, not a removal: both headings survive, and their text is
    // untouched. A fix that simply dropped the document's `h1` would pass the test above
    // and lose content the screen exists to show.
    expect(markup).toMatch(/<h2[^>]*>Life insurance<\/h2>/u);
    expect(markup).toMatch(/<h3[^>]*>About you<\/h3>/u);
  });

  it("leaves the compiled typography alone, so the preview still shows what was served", () => {
    // `size` and `weight` are not part of the demotion. The form title keeps whatever the
    // compiler gave it and therefore still looks like the heading a respondent saw; only
    // its level moved. Asserted through the class the vendored `Text` derives from those
    // props, which is the observable end of that decision.
    const title = /<h2[^>]*class="([^"]*)"[^>]*>Life insurance<\/h2>/u.exec(markup);
    const stepTitle = /<h3[^>]*class="([^"]*)"[^>]*>About you<\/h3>/u.exec(markup);
    expect(title?.[1]).toBeDefined();
    // The two compiled headings in this fixture carry no size/weight props, so they render
    // with identical classes: the point is that demotion changed neither of them.
    expect(title?.[1]).toBe(stepTitle?.[1]);
  });
});
