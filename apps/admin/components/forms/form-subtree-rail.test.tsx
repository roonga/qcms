import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DraftStep } from "../../lib/forms/types.ts";
import type { RailCurrent } from "../../lib/forms/subtree-rail.ts";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const STEPS: readonly DraftStep[] = [
  { stepId: "stp_about", title: { en: "About you" }, items: [] },
  { stepId: "stp_health", title: { en: "Health" }, items: [] },
];

async function render(
  current: RailCurrent,
  steps: readonly DraftStep[] = STEPS,
  issueCounts: ReadonlyMap<string, number> = new Map([["stp_health", 2]]),
): Promise<string> {
  const { FormSubtreeRail } = await import("./form-subtree-rail.tsx");
  return renderToStaticMarkup(
    <FormSubtreeRail
      formId="frm_life"
      slug="life"
      title=""
      status="open"
      steps={steps}
      issueCounts={issueCounts}
      current={current}
      actions={<span data-testid="stub-actions" />}
    />,
  );
}

const LINKS: RailCurrent = { kind: "section", section: "links" };

describe("the rail's markup", () => {
  it("is an aside named for the form, holding a nav named for its sections", async () => {
    const html = await render(LINKS);
    expect(html).toContain('<aside id="qcms-rail-region" class="qcms-rail" aria-label="life"');
    expect(html).toContain('<nav aria-label="life sections">');
    expect(html).not.toContain("qcms-rail--form");
  });

  it("puts the five parts in the contract's order", async () => {
    const html = await render(LINKS);
    const at = (needle: string): number => {
      const index = html.indexOf(needle);
      expect(index, `${needle} is in the rail`).toBeGreaterThan(-1);
      return index;
    };
    expect(at('class="qcms-rail__back"')).toBeLessThan(at("<summary"));
    expect(at("<summary")).toBeLessThan(at("<nav"));
    expect(at("<nav")).toBeLessThan(at('class="qcms-rail__actions"'));
  });

  it("carries the way back to Forms, and the form's status as its one tag", async () => {
    const html = await render(LINKS);
    expect(html).toContain('href="/forms" class="qcms-rail__back"');
    expect(html).toContain(">Forms</a>");
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).toContain('class="qcms-tag qcms-tag--form-open" data-status="open"');
    expect(summary).toContain(">Open</span>");
  });

  it("holds the Add step control it is handed, in the Actions part", async () => {
    const html = await render(LINKS);
    const actions = html.slice(html.indexOf('class="qcms-rail__actions"'));
    expect(actions).toContain("stub-actions");
    expect(html.indexOf("stub-actions")).toBeGreaterThan(
      html.indexOf('data-rail-group="sections"'),
    );
  });

  it("orders the tree with each step nested inside the Form row", async () => {
    const html = await render(LINKS);
    const anchors = [...html.matchAll(/<a href="([^"]+)"/gu)].map((match) => match[1]);
    expect(anchors).toStrictEqual([
      "/forms",
      "/forms/frm_life",
      "/forms/frm_life#step-stp_about",
      "/forms/frm_life#step-stp_health",
      "/forms/frm_life/rules",
      "/forms/frm_life/preview",
      "/forms/frm_life/versions",
      "/forms/frm_life/publish",
      "/forms/frm_life/links",
      "/forms/frm_life/responses",
      "/forms/frm_life/webhooks",
    ]);
    const formRow = html.slice(html.indexOf('data-rail-item="section:builder"'));
    expect(formRow.slice(0, formRow.indexOf("</li>"))).toContain('data-rail-group="steps"');
  });

  it("draws one tree and no divider, because there are no longer two groups", async () => {
    const html = await render(LINKS);
    expect(html).not.toContain("qcms-rail__divider");
    expect([...html.matchAll(/data-rail-group="sections"/gu)]).toHaveLength(1);
    expect([...html.matchAll(/data-rail-group="steps"/gu)]).toHaveLength(1);
  });

  it("drops the divider with the group, when a form has no steps to separate", async () => {
    const html = await render(LINKS, []);
    expect(html).not.toContain("qcms-rail__divider");
    expect(html).not.toContain('data-rail-group="steps"');
    expect(html).toContain('data-rail-group="sections"');
  });

  it("marks the current row with aria-current, and only that row", async () => {
    const html = await render(LINKS);
    expect([...html.matchAll(/aria-current="page"/gu)]).toHaveLength(1);
    expect(html).toContain('href="/forms/frm_life/links" class="qcms-rail__link" ');
    expect(html).toMatch(/href="\/forms\/frm_life\/links"[^>]*aria-current="page"/u);
  });

  it("badges the step that has issues and leaves the others bare", async () => {
    const html = await render(LINKS);
    expect(html).toContain('data-rail-issues="2"');
    expect(html).toContain("2 issues");
    expect([...html.matchAll(/data-rail-issues=/gu)]).toHaveLength(1);
  });

  it("collapses into a native details, open, so the disclosure needs no script", async () => {
    const html = await render(LINKS);
    expect(html).toContain('<details class="qcms-rail__disclosure" open=""');
    expect(html).toContain('<summary class="qcms-rail__summary">');
  });

  it("names the form in the Header, with the form's own issue total", async () => {
    const onASection = await render(LINKS);
    expect(onASection).toMatch(/<span class="qcms-rail__summary-text">life<\/span>/u);
    expect(onASection).toMatch(/data-testid="qcms-rail-summary-count">2 issues</u);

    const onAStep = await render({ kind: "step", stepId: "stp_health" });
    expect(onAStep).toMatch(/<span class="qcms-rail__summary-text">life<\/span>/u);
    expect(onAStep).toMatch(/data-testid="qcms-rail-summary-count">2 issues</u);
  });

  it("leaves every step bare rather than badging a zero it was never given", async () => {
    const noVerdict = await render(LINKS, STEPS, new Map());
    expect(noVerdict, "no verdict, no badge").not.toContain("data-rail-issues");

    const withVerdict = await render(LINKS, STEPS, new Map([["stp_health", 2]]));
    expect(withVerdict).toContain('data-rail-issues="2"');
  });

  it("drops the Header's count when the form has no issues at all", async () => {
    const html = await render(LINKS, STEPS, new Map());
    expect(html).toMatch(/<span class="qcms-rail__summary-text">life<\/span>/u);
    expect(html).not.toContain("qcms-rail-summary-count");
  });

  it("renders no heading, so it cannot break heading order on the screen it precedes", async () => {
    const html = await render(LINKS);
    expect(html).not.toMatch(/<h[1-6][\s>]/u);
  });

  it("orders the steps as a list and the sections as an unordered one", async () => {
    const html = await render(LINKS);
    expect(html).toContain('<ol class="qcms-rail__group" aria-label="Steps"');
    expect(html).toContain('<ul class="qcms-rail__group" aria-label="Sections"');
  });
});
