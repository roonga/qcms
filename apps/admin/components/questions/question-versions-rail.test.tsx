import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { questionPanels } from "../../lib/questions/panels.ts";
import type {
  QuestionDefinitionView,
  QuestionStatus,
  QuestionVersion,
} from "../../lib/questions/types.ts";

/**
 * The question rail's MARKUP contract (issue 650, built to
 * `plan/admin-shell-poc/question-editor-poc.html`; panels, details and back link added
 * 2026-09-27 by the Code Owner).
 *
 * `lib/questions/version-rail.test.ts` and `lib/questions/panels.test.ts` next door pin what
 * the rail carries. This file pins the things that are only true of the rendered element, and
 * each is a clause a future change could break without breaking anything else:
 *
 * - **Anchors for the versions, buttons for the panels.** A version row goes to another
 *   address, so it has to be middle-clickable and openable in a new tab; a panel row switches
 *   what the column beside the rail shows on the screen the reader is already standing on, so
 *   there is nothing to open (`docs/admin-constraints.md`: an anchor navigates, a button acts).
 *   Getting either the wrong way round is invisible until someone tries to open a version in a
 *   tab, or until a panel row navigates out from under a half-typed label.
 * - **The panel rows are nested inside the SELECTED version's row.** A panel row opens a panel
 *   of the editor, and the editor is showing one version. Rows under every version would be
 *   rows that cannot do what they say.
 * - **A disclosure that is a real one.** A native `<details open>` gives the collapsed state
 *   its keyboard operation and its announced state for free; something rebuilt out of a
 *   `<button>` and `aria-expanded` would look identical and be a different promise.
 * - **The back link is outside the disclosure.** Inside it, it is reachable only by expanding
 *   a navigation, because below `--bp-sidebar` the body is shut.
 * - **No headings.** The rail renders before `<main>` in document order, so a heading here
 *   would sit above the screen's `<h1>` and be a `heading-order` violation on this screen in
 *   all three modes (`e2e/a11y-axe.pw.ts` says so). The POC draws the group's name as a
 *   labelled row rather than a heading for its own version of that reason, and the details
 *   group added in 2026-09 is a description list for the same one.
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
 * keyboard, a panel row actually switching the column - is
 * `apps/admin/e2e/questions-rail.pw.ts`, because every one of those is a computed style or an
 * interaction rather than markup.
 *
 * ## The stubbed slot
 *
 * The rail's own tree is real, panel rows included: they are a client component, and on the
 * server their store publishes nothing, so what renders is the panels this test hands in. The
 * lifecycle actions are NOT rendered here even in stub form beyond a marker element: they are
 * a react-aria `Dialog` subtree, which `renderToStaticMarkup` yields the empty string for
 * (issue 628), and they are exercised where a browser is (`e2e/questions-lifecycle.pw.ts`).
 */

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * A `number` with both bounds set, so the rail has more than one panel to list and each has
 * something to digest. The old stub was `{ type: "shortText" }` and it would still work; this
 * one makes the panel assertions below about a real document rather than about an empty one.
 */
const DEFINITION = {
  questionId: "q_smoking_status",
  type: "number",
  label: { en: "Cigarettes per day" },
  required: true,
  constraints: { min: 0, max: 60 },
} as unknown as QuestionDefinitionView;

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

const PANELS = questionPanels(DEFINITION);

async function render(
  selected = 3,
  versions: readonly QuestionVersion[] = VERSIONS,
  actions: ReactNode = <span data-testid="stub-actions" />,
  panel: "content" | "constraints" | "messages" = "content",
): Promise<string> {
  const { QuestionVersionsRail } = await import("./question-versions-rail.tsx");
  return renderToStaticMarkup(
    <QuestionVersionsRail
      questionId="q_smoking_status"
      slug="smoking-status"
      createdAt="2025-06-01T09:00:00.000Z"
      versions={versions}
      selected={selected}
      panels={PANELS}
      panel={panel}
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

  it("puts the way back at the top of the rail, outside the disclosure", async () => {
    const html = await render();
    // Below `--bp-sidebar` the disclosure's body is shut, so a back link inside it would be
    // reachable only by expanding a navigation first.
    expect(html.indexOf('href="/questions"')).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain('class="qcms-question-rail__back"');
    expect(html).toContain("Back to questions");
  });

  it("states the question's own details under its id, as a description list", async () => {
    const html = await render();
    expect(html).toContain('<dl class="qcms-question-rail__details">');
    expect(html).toContain("<dt>Slug</dt>");
    expect(html).toContain("smoking-status</dd>");
    expect(html).toContain("<dt>Created</dt>");
    // ADR-27 through `lib/i18n/format`, pinned to UTC for the reason issue #582 records.
    expect(html).toContain("Jun 1, 2025</dd>");
  });

  it("states the type once, with its locked status, and never inside the editor", async () => {
    // R6 makes the type permanent. It used to be said twice - here and as "Type is locked to
    // Number." at the top of the version card - and the second sentence is gone.
    const html = await render();
    expect(html).toContain("<dt>Type</dt>");
    expect(html).toContain("Number (locked)");
    expect(html).not.toContain("Type is locked to");
  });

  it("makes every version row an anchor that goes somewhere", async () => {
    const anchors = [...(await render()).matchAll(/<a href="([^"]+)"/gu)].map((match) => match[1]);
    expect(anchors).toStrictEqual([
      "/questions",
      "/questions/q_smoking_status?v=3",
      "/questions/q_smoking_status?v=2",
      "/questions/q_smoking_status?v=1",
    ]);
  });

  it("makes every panel row a button, under the selected version and only it", async () => {
    const html = await render(2);
    const rows = [...html.matchAll(/data-rail-panel="([^"]+)"/gu)].map((match) => match[1]);
    // One set of rows, not one per version: the editor is showing one version.
    expect(rows).toStrictEqual(PANELS.map((panel) => panel.id));
    // Nested INSIDE the selected row, between it and the next version's row.
    const selectedRow = html.indexOf('data-rail-version="2"');
    const olderRow = html.indexOf('data-rail-version="1"');
    const panels = html.indexOf('data-rail-panels=""');
    expect(selectedRow).toBeLessThan(panels);
    expect(panels).toBeLessThan(olderRow);
  });

  it("names each panel row and digests what is in it", async () => {
    const html = await render();
    for (const panel of PANELS) {
      expect(html).toContain(`>${panel.label}</span>`);
      expect(html).toContain(`>${panel.digest}</span>`);
    }
  });

  it("carries no aria-controls, because four of the five ids are not in the document", async () => {
    // The Settings rail's rows carry one and may: that screen renders all three panels and
    // hides two. This editor renders ONE, so every row but the open one would name an element
    // that is not there, which `aria-valid-attr-value` reports in all three modes
    // (`e2e/a11y-axe.pw.ts` caught exactly that). `aria-current="page"` is the whole of the
    // accessible statement about which panel is open.
    expect(await render()).not.toContain("aria-controls");
  });

  it("keeps the panel list out of the form rail's group attribute", async () => {
    // `[data-rail-group]` is what `app/globals.css` keys the "no accent edge" rule off, and
    // this rail keeps its edge: it is a flat list of one kind of row.
    expect(await render()).not.toContain("data-rail-group");
  });

  it("marks one version row and one panel row current, and no more", async () => {
    const html = await render(2, VERSIONS, <span data-testid="stub-actions" />, "constraints");
    expect([...html.matchAll(/aria-current="page"/gu)]).toHaveLength(2);
    expect(html).toContain('data-rail-version="2" aria-current="page"');
    expect(html).toContain('aria-current="page" data-rail-panel="constraints"');
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

  it("badges no panel before a save has been refused", async () => {
    // The server has no verdict, so it has no all-clear to fabricate either: no counts, no
    // badges, the same silence the builder's step rows keep.
    expect(await render()).not.toContain("data-rail-issues");
  });
});
