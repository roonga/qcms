import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  QuestionDefinitionView,
  QuestionStatus,
  QuestionVersion,
} from "../../lib/questions/types.ts";

/**
 * The question rail's MARKUP contract (issue 650, built to
 * `plan/admin-shell-poc/question-editor-poc.html`).
 *
 * `lib/questions/version-rail.test.ts` next door pins what the rail carries. This file pins
 * the things that are only true of the rendered element, and each is a clause a future change
 * could break without breaking anything else:
 *
 * - **Anchors for the rows.** A version row goes to another address, so it has to be
 *   middle-clickable, openable in a new tab and followable with JavaScript off
 *   (`docs/admin-constraints.md`: an anchor navigates, a button acts). The rail's own
 *   markup contains no button at all; the lifecycle controls arrive as a slot, which is
 *   what lets this test say "no buttons of its own" and mean it.
 * - **A disclosure that is a real one.** A native `<details open>` gives the collapsed state
 *   its keyboard operation and its announced state for free; something rebuilt out of a
 *   `<button>` and `aria-expanded` would look identical and be a different promise.
 * - **No headings.** The rail renders before `<main>` in document order, so a heading here
 *   would sit above the screen's `<h1>` and be a `heading-order` violation on this screen in
 *   all three modes (`e2e/a11y-axe.pw.ts` says so). The POC draws the group's name as a
 *   labelled row rather than a heading for its own version of that reason.
 * - **`rail-frame.tsx` is not imported.** The `<details>` chrome is restated locally, which
 *   is a decision recorded in the component's own doc; asserting the absence of the import
 *   would be asserting a file's text, so what is asserted instead is the thing the local
 *   copy exists for - the collapsed-only version indicator, which `RailFrame`'s summary has
 *   no place for.
 *
 * ## Why this layer
 *
 * `renderToStaticMarkup` is the highest layer that can see the whole rail at once without a
 * browser (ADR-23). What genuinely needs one - the 240px track appearing at `--bp-sidebar`,
 * the collapsed-only indicator appearing only below it, the disclosure opening from the
 * keyboard - is `apps/admin/e2e/questions-rail.pw.ts`, because every one of those is a
 * computed style or an interaction rather than markup.
 *
 * ## The stubbed slot
 *
 * The rail's own tree is real. The lifecycle actions are NOT rendered here even in stub form
 * beyond a marker element: they are a react-aria `Dialog` subtree, which
 * `renderToStaticMarkup` yields the empty string for (issue 628), and they are exercised
 * where a browser is (`e2e/questions-lifecycle.pw.ts`).
 */

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const DEFINITION = { type: "shortText" } as unknown as QuestionDefinitionView;

function version(n: number, status: QuestionStatus, publishedAt: string | null): QuestionVersion {
  return {
    questionId: "q_smoking_status",
    version: n,
    status,
    definition: DEFINITION,
    publishedAt,
  };
}

const VERSIONS: readonly QuestionVersion[] = [
  version(1, "deprecated", "2025-06-20T09:00:00.000Z"),
  version(2, "published", "2026-05-14T09:00:00.000Z"),
  version(3, "draft", null),
];

async function render(
  selected = 3,
  versions: readonly QuestionVersion[] = VERSIONS,
  actions: ReactNode = <span data-testid="stub-actions" />,
): Promise<string> {
  const { QuestionVersionsRail } = await import("./question-versions-rail.tsx");
  return renderToStaticMarkup(
    <QuestionVersionsRail
      questionId="q_smoking_status"
      versions={versions}
      selected={selected}
      actions={actions}
    />,
  );
}

describe("the question rail's markup", () => {
  it("takes the shared rail column, under a name of its own", async () => {
    const html = await render();
    expect(html).toContain('class="qcms-rail qcms-question-rail"');
    expect(html).toContain('data-testid="qcms-question-rail"');
  });

  it("is a real disclosure, open, with the question id as its summary", async () => {
    const html = await render();
    expect(html).toContain('<details class="qcms-rail__disclosure" open');
    expect(html).toContain("<summary");
    expect(html).toContain("q_smoking_status</span>");
  });

  it("names the selected version in the summary, which is what the collapsed rail shows", async () => {
    expect(await render(2)).toContain("Version 2");
  });

  it("is a navigation landmark named after the question it belongs to", async () => {
    expect(await render()).toContain('<nav aria-label="Versions of q_smoking_status">');
  });

  it("carries no heading, because the rail renders above the screen's h1", async () => {
    expect(await render()).not.toMatch(/<h[1-6]/u);
  });

  it("holds no button of its own: every row is an anchor that goes somewhere", async () => {
    const html = await render();
    expect(html).not.toContain("<button");
    const anchors = [...html.matchAll(/<a href="([^"]+)"/gu)].map((match) => match[1]);
    expect(anchors).toStrictEqual([
      "/questions/q_smoking_status?v=3",
      "/questions/q_smoking_status?v=2",
      "/questions/q_smoking_status?v=1",
    ]);
  });

  it("marks exactly one row current, with the value the stylesheet keys off", async () => {
    const html = await render(2);
    expect([...html.matchAll(/aria-current="page"/gu)]).toHaveLength(1);
    expect(html).toContain('data-rail-version="2" aria-current="page"');
  });

  it("spells each version's status out beside it rather than colouring the row", async () => {
    const html = await render();
    expect(html).toContain('data-status="draft"');
    expect(html).toContain('data-status="published"');
    expect(html).toContain('data-status="deprecated"');
  });

  it("says when each version was published, locale-aware, and says so when it never was", async () => {
    const html = await render();
    // ADR-27, through `lib/i18n/format`: a rendered date, pinned to UTC so the server and
    // the browser agree, rather than the wire representation with its tail cut off (issue 277).
    expect(html).toContain("Published May 14, 2026");
    expect(html).toContain("Never published");
  });

  it("digests the group above it: how many versions, and which one is live", async () => {
    expect(await render()).toContain("3 versions, v2 published");
  });

  it("says so plainly when nothing has been published, in the singular where it applies", async () => {
    expect(await render(1, [version(1, "draft", null)])).toContain("1 version, none published");
  });

  it("renders the actions it is handed, above the list, and nothing when handed none", async () => {
    const withActions = await render();
    expect(withActions.indexOf("stub-actions")).toBeLessThan(withActions.indexOf("<nav"));
    expect(await render(3, VERSIONS, null)).not.toContain("stub-actions");
  });
});
