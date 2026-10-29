import { render as renderClient } from "@testing-library/react";
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
 * - **Anchors for both kinds of row** (§7.0 ruling 2.2, issue #1116). A version row goes to
 *   another address and always was one; a panel row was a `<button>`, on the rule that an
 *   anchor navigates and a button acts, and the ruling settles it the other way for a rail row
 *   so that one rail has one kind of row. Its `href` is the panel's own section id, which is
 *   the id the editor puts on the open panel, so the fragment is an address a reader can copy
 *   rather than a decoration.
 * - **The panel rows are nested inside the SELECTED version's row.** A panel row opens a panel
 *   of the editor, and the editor is showing one version. Rows under every version would be
 *   rows that cannot do what they say.
 * - **A disclosure that is a real one.** A native `<details open>` gives the collapsed state
 *   its keyboard operation and its announced state for free; something rebuilt out of a
 *   `<button>` and `aria-expanded` would look identical and be a different promise.
 * - **The back link is outside the disclosure.** Inside it, it is reachable only by expanding
 *   a navigation, because below `--bp-sidebar` the body is shut. It is not inside the
 *   `<summary>` either, where §7.0 draws the Header's parts: a `<summary>` is exposed as a
 *   button, and a link inside one is nested interactive content.
 * - **No headings.** The rail renders before `<main>` in document order, so a heading here
 *   would sit above the screen's `<h1>` and be a `heading-order` violation on this screen in
 *   all three modes (`e2e/a11y-axe.pw.ts` says so). The POC draws the group's name as a
 *   labelled row rather than a heading for its own version of that reason, and the details
 *   group added in 2026-09 is a description list for the same one.
 * - **The summary is the question id alone** (Code Owner, 2026-09-29). It carried a
 *   collapsed-only "/ Version 2" from issue 650, which earned its place while that line was the
 *   whole rail at 390; the screen's `<h1>` names the version now, one row under it, so the two
 *   said the same thing twice. `e2e/questions-rail.pw.ts` asserts the other half of that trade -
 *   that the heading really does carry the version - because deleting the indicator is only
 *   right while it does.
 *
 * ## Why this layer
 *
 * `renderToStaticMarkup` is the highest layer that can see the whole rail at once without a
 * browser (ADR-23). What genuinely needs one - the 240px track appearing at `--bp-sidebar`,
 * the disclosure opening from the keyboard, a panel row actually switching the column - is
 * `apps/admin/e2e/questions-rail.pw.ts`, because every one of those is a computed style or an
 * interaction rather than markup.
 *
 * ## The stubbed slot
 *
 * The rail's own tree is real, panel rows included: they are a client component, and on the
 * server their store publishes nothing, so what renders is the panels this test hands in. The
 * Actions part is NOT rendered here even in stub form beyond a marker element: `NewVersionAction`
 * is a react-aria `Dialog` subtree, which `renderToStaticMarkup` yields the empty string for
 * (issue 628), and it is exercised where a browser is (`e2e/questions-lifecycle.pw.ts`) - which
 * is also where the lifecycle pair's move OUT of this rail and into the screen's heading row is
 * asserted (§7.0 ruling 5).
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

/**
 * The rail as the browser shows it once the operator's zone is known (Code Owner ruling
 * 2026-10-19): admin times paint nothing on the server, so the dates are read off a
 * client render, with the process zone pinned to UTC so the expectation is a fact rather
 * than the runner's clock.
 */
async function renderedText(): Promise<string> {
  const { QuestionVersionsRail } = await import("./question-versions-rail.tsx");
  const original = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const { container, unmount } = renderClient(
      <QuestionVersionsRail
        questionId="q_smoking_status"
        slug="smoking-status"
        createdAt="2025-06-01T09:00:00.000Z"
        versions={VERSIONS}
        selected={3}
        panels={PANELS}
        panel="content"
        actions={<span data-testid="stub-actions" />}
      />,
    );
    const text = container.textContent ?? "";
    unmount();
    return text;
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

describe("the question rail's markup", () => {
  it("takes the one rail frame, with no class of its own beside it", async () => {
    const html = await render();
    // One geometry class and no per-rail modifier: three rails wore three (`qcms-rail
    // qcms-question-rail`, `qcms-rail qcms-settings-rail`, `qcms-rail--form`) until §7.0
    // made the anatomy one. The test handle stays, because a screen's coverage needs to
    // find its own rail.
    expect(html).toContain('class="qcms-rail"');
    expect(html).not.toContain("qcms-rail qcms-question-rail");
    expect(html).not.toContain("qcms-question-rail__");
    expect(html).toContain('data-testid="qcms-question-rail"');
  });

  it("is a real disclosure, open, with the question id as its summary", async () => {
    const html = await render();
    expect(html).toContain('<details class="qcms-rail__disclosure" open');
    expect(html).toContain("<summary");
    expect(html).toContain("q_smoking_status</span>");
  });

  it("collapses to the question id alone, with no version beside it", async () => {
    // Issue 650's collapsed-only "/ Version 2" is retired (Code Owner, 2026-09-29): the screen's
    // `<h1>` names the version, one row under this summary, so at 390 the two said the same thing
    // twice. The summary now reads like the form rail's - the thing the rail belongs to.
    const html = await render(2);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).toContain("q_smoking_status");
    expect(summary, "the version is the heading's job now").not.toContain("Version");
  });

  it("is an aside named for the question, holding a nav named for its sections", async () => {
    const html = await render();
    // The column is complementary content about the subject; the version list inside it is
    // the navigation. It was a `<nav>` all the way out, which made the panel switches, the
    // facts and the actions part of a navigation landmark too (§7.0 ruling 2).
    expect(html).toContain('<aside id="qcms-rail-region" class="qcms-rail" aria-label="q_smoking_status"');
    expect(html).toContain('<nav aria-label="q_smoking_status sections">');
  });

  it("carries no heading, because the rail renders above the screen's h1", async () => {
    expect(await render()).not.toMatch(/<h[1-6]/u);
  });

  it("puts the way back at the top of the rail, outside the disclosure", async () => {
    const html = await render();
    // Below `--bp-sidebar` the disclosure's body is shut, so a back link inside it would be
    // reachable only by expanding a navigation first.
    expect(html.indexOf('href="/questions"')).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain('class="qcms-rail__back"');
    // "Questions" - the parent SCREEN's name, which is what §7.0 asks a back link to say,
    // rather than the sentence "Back to questions" this link used to carry. The glyph
    // beside it is decorative.
    expect(html).toContain("Questions");
  });

  it("states the question's own details under its id, as a description list", async () => {
    const html = await render();
    expect(html).toContain('<dl class="qcms-rail__facts">');
    expect(html).toContain("<dt>Slug</dt>");
    expect(html).toContain("smoking-status</dd>");
    expect(html).toContain("<dt>Created</dt>");
    // The server paints the instant and no text: the day is the operator's, so it exists
    // only once the browser has said which zone that is (Code Owner, 2026-10-19).
    expect(html).toContain('<dd><time dateTime="2025-06-01T09:00:00.000Z"></time></dd>');
    // ADR-27 through `lib/i18n/format`, in the default en-GB locale.
    expect(await renderedText()).toContain("Created1 Jun 2025");
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
    const anchors = [...(await render()).matchAll(/<a href="(\/[^"]*)"/gu)].map(
      (match) => match[1],
    );
    expect(anchors).toStrictEqual([
      "/questions",
      "/questions/q_smoking_status?v=3",
      "/questions/q_smoking_status?v=2",
      "/questions/q_smoking_status?v=1",
    ]);
  });

  it("makes every panel row an anchor onto the panel's own section id", async () => {
    // §7.0 ruling 2.2: a rail row is an anchor, never a button. The fragment is
    // `panel.anchorId`, which is the id the editor puts on the panel it renders and the id
    // a refused save moves focus to, so the row's `href` and the editor's own anchor are
    // one value rather than two that have to be kept equal.
    const html = await render();
    expect(html.slice(html.indexOf("<details"))).not.toContain("<button");
    for (const panel of PANELS) {
      expect(html).toContain(`href="#${panel.anchorId}"`);
    }
  });

  it("puts the panel rows under the selected version and only it", async () => {
    const html = await render(2);
    const rows = [...html.matchAll(/data-rail-panel="([^"]+)"/gu)].map((match) => match[1]);
    // One set of rows, not one per version: the editor is showing one version.
    expect(rows).toStrictEqual(PANELS.map((panel) => panel.id));
    // Nested INSIDE the selected row, between it and the next version's row - the same shape
    // the builder's steps take inside its Form row.
    const selectedRow = html.indexOf('data-rail-version="2"');
    const olderRow = html.indexOf('data-rail-version="1"');
    const panels = html.indexOf('data-rail-group="panels"');
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
    const html = await render();
    expect(html.slice(html.indexOf("<details"))).not.toContain("aria-controls");
  });

  it("wears the form builder's row and group classes, on the 2026-09-27 ruling", async () => {
    // The Code Owner's direction is that this rail is styled like the builder's, so what is
    // asserted is the shared vocabulary rather than a look of its own: rows are
    // `.qcms-rail__link`, groups carry `data-rail-group`, and the six question-only classes
    // that used to draw a header row, a dashed lifecycle rule and two bespoke two-line rows
    // are gone.
    const html = await render();
    expect(html).toContain('data-rail-group="versions"');
    // The panel list carries it too since #1116: it used to be withheld deliberately,
    // because `[data-rail-group]` was the selector that removed a current row's accent edge
    // in the form rail, and §7.0 demotes the PARENT of the current row instead.
    expect(html).toContain('data-rail-group="panels"');
    expect(html).toContain('class="qcms-rail__link qcms-rail__link--stacked"');
    expect(html).toContain('class="qcms-rail__row"');
    expect(html).toContain('class="qcms-rail__sub"');
    for (const retired of [
      "qcms-question-rail__label",
      "qcms-question-rail__title",
      "qcms-question-rail__version",
      "qcms-question-rail__panel-row",
      "qcms-question-rail__panel-digest",
      // And the four this rail kept until #1116, which are `qcms-rail__*` now because the
      // anatomy is one: the mono subject id, the fact lines, the digest, the back link.
      "qcms-question-rail__summary-id",
      "qcms-question-rail__details",
      "qcms-question-rail__digest",
      "qcms-question-rail__back",
    ]) {
      expect(html, `${retired} has a builder equivalent now`).not.toContain(retired);
    }
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
    // ADR-27, through `lib/i18n/format`: a rendered date on the operator's clock, rather
    // than the wire representation with its tail cut off (issue 277).
    const text = await renderedText();
    expect(text).toContain("Published 14 May 2026");
    expect(text).toContain("Never published");
  });

  it("digests the group above it: how many versions, and which one is live", async () => {
    expect(await render()).toContain("3 versions, v2 published");
  });

  it("says so plainly when nothing has been published, in the singular where it applies", async () => {
    expect(await render(1, [version(1, "draft", null)])).toContain("1 version, none published");
  });

  it("renders the actions it is handed, in the Actions part under the list", async () => {
    // BELOW the sections now, not above them (§7.0 ruling 2: Header, Sections, Children,
    // Filters, Actions, always in that order). The lifecycle block used to be pinned above
    // the version list because that list grows without bound and an action under it would
    // drift down the rail with every version; the ruling answers that by taking the
    // lifecycle pair out of the rail altogether and leaving one structural action here.
    const withActions = await render();
    expect(withActions.indexOf("<nav")).toBeLessThan(withActions.indexOf("stub-actions"));
    expect(withActions).toContain('<div class="qcms-rail__actions">');
    expect(await render(3, VERSIONS, null)).not.toContain("stub-actions");
  });

  it("states the selected version's status in the Header, as its one tag", async () => {
    // §7.0's table gives this rail's Header the question id and a status. One tag: the
    // frame takes a single node, and the version rows carry their own further down.
    const header = (await render(2)).slice(0, (await render(2)).indexOf("qcms-rail__facts"));
    expect(header).toContain('data-status="published"');
    expect([...header.matchAll(/class="qcms-tag/gu)]).toHaveLength(1);
  });

  it("badges no panel before a save has been refused", async () => {
    // The server has no verdict, so it has no all-clear to fabricate either: no counts, no
    // badges, the same silence the builder's step rows keep.
    expect(await render()).not.toContain("data-rail-issues");
  });
});
