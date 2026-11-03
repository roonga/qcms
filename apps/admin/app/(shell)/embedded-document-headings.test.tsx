import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FormVersionSnapshot } from "../../lib/forms/types.ts";

// Use the real renderer: a stub cannot prove the heading offset reaches embedded documents.
vi.mock("@/components/kit", () => import("../../components/kit.tsx"));
vi.mock(
  "@/components/preview-theme-island",
  () => import("../../components/preview-theme-island.tsx"),
);
vi.mock("@/lib/i18n/en", () => import("../../lib/i18n/en.ts"));
vi.mock("@/lib/page-headings", () => import("../../lib/page-headings.ts"));
vi.mock("@/lib/preview-theme", () => import("../../lib/preview-theme.ts"));

const { VersionView } = await import("../../components/forms/version-view.tsx");

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
    expect(markup).toMatch(/<h2[^>]*>Life insurance<\/h2>/u);
    expect(markup).toMatch(/<h3[^>]*>About you<\/h3>/u);
  });

  it("leaves the compiled typography alone, so the preview still shows what was served", () => {
    const title = /<h2[^>]*class="([^"]*)"[^>]*>Life insurance<\/h2>/u.exec(markup);
    const stepTitle = /<h3[^>]*class="([^"]*)"[^>]*>About you<\/h3>/u.exec(markup);
    expect(title?.[1]).toBeDefined();
    expect(title?.[1]).toBe(stepTitle?.[1]);
  });
});
