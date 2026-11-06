import { render as renderClient } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { questionPanels } from "../../lib/questions/panels.ts";
import { QuestionVersionsRail } from "./question-versions-rail.tsx";
import type {
  QuestionDefinitionView,
  QuestionStatus,
  QuestionVersion,
} from "../../lib/questions/types.ts";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

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

function render(
  selected = 3,
  versions: readonly QuestionVersion[] = VERSIONS,
  actions: ReactNode = <span data-testid="stub-actions" />,
  panel: "content" | "constraints" | "messages" = "content",
): string {
  return renderToStaticMarkup(
    <QuestionVersionsRail
      questionId="q_smoking_status"
      versions={versions}
      selected={selected}
      panels={PANELS}
      panel={panel}
      actions={actions}
    />,
  );
}

function renderedText(): string {
  const original = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const { container, unmount } = renderClient(
      <QuestionVersionsRail
        questionId="q_smoking_status"
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
  it("takes the one rail frame, with no class of its own beside it", () => {
    const html = render();
    expect(html).toContain('class="qcms-rail"');
    expect(html).not.toContain("qcms-rail qcms-question-rail");
    expect(html).not.toContain("qcms-question-rail__");
    expect(html).toContain('data-testid="qcms-question-rail"');
  });

  it("is a real disclosure, open, with the question id as its summary", () => {
    const html = render();
    expect(html).toContain('<details class="qcms-rail__disclosure" open');
    expect(html).toContain("<summary");
    expect(html).toContain("q_smoking_status</span>");
  });

  it("collapses to the question id alone, with no version beside it", () => {
    const html = render(2);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).toContain("q_smoking_status");
    expect(summary, "the version is the heading's job now").not.toContain("Version");
  });

  it("is an aside named for the question, holding a nav named for its sections", () => {
    const html = render();
    expect(html).toContain(
      '<aside id="qcms-rail-region" class="qcms-rail" aria-label="q_smoking_status"',
    );
    expect(html).toContain('<nav aria-label="q_smoking_status sections">');
  });

  it("carries no heading, because the rail renders above the screen's h1", () => {
    expect(render()).not.toMatch(/<h[1-6]/u);
  });

  it("puts the way to all questions at the top of the rail, outside the disclosure", () => {
    const html = render();
    expect(html.indexOf('href="/questions"')).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain('class="qcms-rail__back"');
    expect(html).toContain("All questions");
  });

  it("makes every version row an anchor that goes somewhere", () => {
    const anchors = [...render().matchAll(/<a href="(\/[^"]*)"/gu)].map((match) => match[1]);
    expect(anchors).toStrictEqual([
      "/questions",
      "/questions/q_smoking_status?v=3",
      "/questions/q_smoking_status?v=2",
      "/questions/q_smoking_status?v=1",
    ]);
  });

  it("makes every panel row an anchor onto the panel's own section id", () => {
    const html = render();
    expect(html.slice(html.indexOf("<details"))).not.toContain("<button");
    for (const panel of PANELS) {
      expect(html).toContain(`href="#${panel.anchorId}"`);
    }
  });

  it("puts the panel rows under the selected version and only it", () => {
    const html = render(2);
    const rows = [...html.matchAll(/data-rail-panel="([^"]+)"/gu)].map((match) => match[1]);
    expect(rows).toStrictEqual(PANELS.map((panel) => panel.id));
    const selectedRow = html.indexOf('data-rail-version="2"');
    const olderRow = html.indexOf('data-rail-version="1"');
    const panels = html.indexOf('data-rail-group="panels"');
    expect(selectedRow).toBeLessThan(panels);
    expect(panels).toBeLessThan(olderRow);
  });

  it("names each panel row and digests what is in it", () => {
    const html = render();
    for (const panel of PANELS) {
      expect(html).toContain(`>${panel.label}</span>`);
      expect(html).toContain(`>${panel.digest}</span>`);
    }
  });

  it("carries no aria-controls, because four of the five ids are not in the document", () => {
    const html = render();
    expect(html.slice(html.indexOf("<details"))).not.toContain("aria-controls");
  });

  it("wears the form builder's row and group classes, on the 2026-09-27 ruling", () => {
    const html = render();
    expect(html).toContain('data-rail-group="versions"');
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
      "qcms-question-rail__summary-id",
      "qcms-question-rail__details",
      "qcms-question-rail__digest",
      "qcms-question-rail__back",
    ]) {
      expect(html, `${retired} has a builder equivalent now`).not.toContain(retired);
    }
  });

  it("marks one version row and one panel row current, and no more", () => {
    const html = render(2, VERSIONS, <span data-testid="stub-actions" />, "constraints");
    expect([...html.matchAll(/aria-current="page"/gu)]).toHaveLength(2);
    expect(html).toContain('data-rail-version="2" aria-current="page"');
    expect(html).toContain('aria-current="page" data-rail-panel="constraints"');
  });

  it("spells each version's status out beside it rather than colouring the row", () => {
    const html = render();
    expect(html).toContain('data-status="draft"');
    expect(html).toContain('data-status="published"');
    expect(html).toContain('data-status="deprecated"');
  });

  it("says when each version was published, locale-aware, and says so when it never was", () => {
    const text = renderedText();
    expect(text).toContain("Published 14 May 2026");
    expect(text).toContain("Never published");
  });

  it("renders the actions it is handed, in the Actions part under the list", () => {
    const withActions = render();
    expect(withActions.indexOf("<nav")).toBeLessThan(withActions.indexOf("stub-actions"));
    expect(withActions).toContain('<div class="qcms-rail__actions">');
    expect(render(3, VERSIONS, null)).not.toContain("stub-actions");
  });

  it("badges no panel before a save has been refused", () => {
    expect(render()).not.toContain("data-rail-issues");
  });
});
