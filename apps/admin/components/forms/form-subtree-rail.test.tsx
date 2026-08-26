import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DraftStep } from "../../lib/forms/types.ts";
import type { RailCurrent } from "../../lib/forms/subtree-rail.ts";

/**
 * The rail's MARKUP contract (`plan/admin-design-contracts.md` §7, issue 559).
 *
 * `lib/forms/subtree-rail.test.ts` next door pins what the rail carries. This file pins
 * the four things that are only true of the rendered element, and each of them is a clause
 * a future change could break without breaking anything else:
 *
 * - **Anchors, not buttons.** §7 says so, and the reason is not styling: an anchor can be
 *   middle-clicked, opened in a new tab and followed with JavaScript disabled, and a
 *   button can do none of those. It is asserted by counting `<button>`, which is also how
 *   "the rail never carries actions" is asserted - the two clauses have the same tell.
 * - **One divider between two groups**, and none when there is only one group.
 * - **A disclosure that is a real one.** A native `<details open>` gives the collapsed
 *   state its keyboard operation and its announced state for free; something rebuilt out
 *   of a `<button>` and `aria-expanded` would look identical and be a different promise.
 * - **No headings.** The rail renders before `<main>` in document order, so a heading in
 *   it would sit above the screen's `<h1>` and be a `heading-order` violation on every
 *   screen that gets a rail.
 *
 * ## Why this layer
 *
 * `renderToStaticMarkup` is the highest layer that can see the whole rail at once without
 * a browser (ADR-23). What genuinely needs one - the 240px track appearing at
 * `--bp-sidebar` and not one pixel below it, the disclosure opening from the keyboard, the
 * ellipsis, and the rail's surface reaching the bottom of a short screen - is
 * `apps/admin/e2e/rail.pw.ts`, because every one of those is a computed style or an
 * interaction rather than markup.
 *
 * ## The alias bridge
 *
 * Same device the app's other component tests use: the admin imports itself through `@/`
 * and the Vitest project has no resolver for it, so each factory hands back the real
 * module by its relative path. Nothing here is a stub except `next/link`, which needs one
 * because it reaches for a router that does not exist outside a Next render.
 */

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/rail-frame", () => import("../rail-frame.tsx"));
vi.mock("@/components/rail-disclosure", () => import("../rail-disclosure.tsx"));
vi.mock("@/lib/forms/subtree-rail", () => import("../../lib/forms/subtree-rail.ts"));
vi.mock("@/lib/i18n/en", () => import("../../lib/i18n/en.ts"));

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
      steps={steps}
      issueCounts={issueCounts}
      current={current}
    />,
  );
}

const LINKS: RailCurrent = { kind: "section", section: "links" };

describe("the rail's markup", () => {
  it("is a navigation landmark named after the form it belongs to", async () => {
    const html = await render(LINKS);
    expect(html).toContain('<nav class="qcms-rail" aria-label="life steps and sections"');
  });

  it("orders the tree with each step nested inside the Form row", async () => {
    const html = await render(LINKS);
    // The steps are inside the Form row rather than above the sections (Code Owner,
    // 2026-08-25), so the anchor order is the tree read depth-first: Form, then its
    // steps, then the five remaining sections. Before the nesting the two step anchors
    // came first, which said they were peers of the six routes rather than children of
    // one of them.
    const anchors = [...html.matchAll(/<a href="([^"]+)"/gu)].map((match) => match[1]);
    expect(anchors).toStrictEqual([
      "/forms/frm_life",
      "/forms/frm_life#step-stp_about",
      "/forms/frm_life#step-stp_health",
      "/forms/frm_life/preview",
      "/forms/frm_life/versions",
      "/forms/frm_life/links",
      "/forms/frm_life/responses",
      "/forms/frm_life/webhooks",
    ]);
    // The nesting is real containment, not an indent: the steps list is INSIDE the
    // Form row's `<li>`, which is what makes a screen reader announce them as belonging
    // to it.
    const formRow = html.slice(html.indexOf('data-rail-item="section:builder"'));
    expect(formRow.slice(0, formRow.indexOf("</li>"))).toContain('data-rail-group="steps"');
  });

  it("draws one tree and no divider, because there are no longer two groups", async () => {
    const html = await render(LINKS);
    // §7's "one divider between two groups" described two groups. There is one list now
    // (contract amended 2026-08-25), so the divider it separated has nothing to separate.
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

  it("names the form in the summary, with the form's own issue total", async () => {
    // Issue 693: the scope, not the active item, which is what the other two rails name and
    // what `admin-shell-poc.html` draws. The badge moves with it - a step's count beside the
    // form's name would be two unrelated facts on one line - so both renders below carry the
    // same "2 issues" while the current row changes underneath them.
    const onASection = await render(LINKS);
    expect(onASection).toMatch(/<span class="qcms-rail__summary-text">life<\/span>/u);
    expect(onASection).toMatch(/data-testid="qcms-rail-summary-count">2 issues</u);

    const onAStep = await render({ kind: "step", stepId: "stp_health" });
    expect(onAStep).toMatch(/<span class="qcms-rail__summary-text">life<\/span>/u);
    expect(onAStep).toMatch(/data-testid="qcms-rail-summary-count">2 issues</u);
  });

  it("leaves every step bare rather than badging a zero it was never given", async () => {
    // Absence rather than a claim: the rail has no "0 issues" state, which is what lets
    // the validation panel's "not checked yet" and this list sit on one screen without
    // contradicting each other (issue 625). This assertion moved here with the steps
    // themselves, from `unvalidated-builder.test.tsx`, when the builder's own step list
    // was retired.
    const noVerdict = await render(LINKS, STEPS, new Map());
    expect(noVerdict, "no verdict, no badge").not.toContain("data-rail-issues");

    const withVerdict = await render(LINKS, STEPS, new Map([["stp_health", 2]]));
    expect(withVerdict).toContain('data-rail-issues="2"');
  });

  it("drops the summary badge when the form has no issues at all", async () => {
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
