import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Issue 679: the five section routes of one form name their section in the `<h1>`.
 *
 * `/forms/[formId]/preview`, `/versions`, `/links`, `/responses` and `/webhooks` all
 * rendered the same heading - the form's slug - so five sibling screens of one form were
 * five pages with identical page headings, and the one landmark heading a screen reader
 * user navigates by answered "which form" rather than "which page" on every one of them.
 * That is the defect issue #510 fixed for the two child-entity routes and left standing
 * one scope out. The approved drawing for two of the five composes both parts:
 * `plan/admin-shell-poc/preview-versions-poc.html` heads them "Draft preview: Life
 * insurance" and "Version history: Life insurance".
 *
 * ## The construction, and why it is one string rather than five
 *
 * `forms.section.heading` is `"{section}: {slug}"`, filled from the `forms.tab.*` name the
 * rail and the breadcrumb already use. ADR-27's reason, not a preference: a preposition
 * form ("Responses to X" but "Links for X") hand-writes English grammar into five separate
 * strings, and a locale that orders the parts differently rewrites all five rather than
 * one. The two POCs disagree on the connector, so this was ruled on the issue rather than
 * transcribed from a drawing.
 *
 * ## The builder is the deliberate asymmetry, and this file pins it
 *
 * `/forms/[formId]` keeps the bare slug and must keep it: the `<h1>` names the page's
 * subject, and on the builder the subject IS the form. It is exempt by construction rather
 * than by omission, because it does not render `FormPageHeader` at all - it hand-rolls the
 * heading from `forms.builder.heading`. The last block below asserts that it still does, in
 * the shape issue #614 used to pin the branch it found correct: the risk being guarded
 * against is a later pass at consistency closing the gap without noticing it was chosen.
 *
 * ## Why this layer
 *
 * `renderToStaticMarkup` of `FormPageHeader` with the real catalog is the smallest render
 * that produces the actual heading string, and the heading string is the whole claim. The
 * five routes reach it by passing no `heading` override, which is a fact about the route
 * files rather than about anything a render can observe, so it is read off their source
 * here, while the ordinary browser suite checks the routed screens.
 */

// The real kit, and the real catalog: this file is about which string the heading holds,
// so a `t` that answers with its own key would assert nothing. `Breadcrumb` reaches no
// react-aria `Modal`, so nothing here meets the empty-markup trap of issue 628.
vi.mock("@/components/kit", () => import("../../components/kit.tsx"));
vi.mock("@/lib/i18n/en", () => import("../../lib/i18n/en.ts"));

const { FormPageHeader } = await import("../../components/forms/form-page-header.tsx");
const { messages, t } = await import("../../lib/i18n/en.ts");

const SLUG = "Life insurance";

/**
 * The five sections this component heads, each with the name it is expected to carry.
 *
 * "Version history" and not "History": see the note on `forms.tab.versions` in the catalog
 * for why that section was renamed rather than left to compose into "History: Life
 * insurance".
 */
const SECTIONS = [
  ["preview", "Preview"],
  ["versions", "Version history"],
  ["links", "Links"],
  ["responses", "Responses"],
  ["webhooks", "Webhooks"],
] as const;

/** The route file each section is served from, relative to this directory. */
const ROUTE_FILES: Readonly<Record<(typeof SECTIONS)[number][0], string>> = {
  preview: "forms/[formId]/preview/page.tsx",
  versions: "forms/[formId]/versions/page.tsx",
  links: "forms/[formId]/links/page.tsx",
  responses: "forms/[formId]/responses/page.tsx",
  webhooks: "forms/[formId]/webhooks/page.tsx",
};

function routeSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/** The text of the first `<h1>` in a static render, with no markup around it. */
function headingText(markup: string): string {
  const match = /<h1[^>]*>([^<]*)<\/h1>/u.exec(markup);
  expect(match, "the header should render an h1").not.toBeNull();
  return match?.[1] ?? "";
}

describe("the section routes name their section in the h1 (issue 679)", () => {
  it.each(SECTIONS)("the %s section reads '%s: <slug>'", (section, name) => {
    const markup = renderToStaticMarkup(
      <FormPageHeader formId="frm_alpha" slug={SLUG} section={section} status="open" />,
    );

    expect(headingText(markup)).toBe(`${name}: ${SLUG}`);
  });

  it("gives the five sections five different headings, which was the defect", () => {
    const headings = SECTIONS.map(([section]) =>
      headingText(
        renderToStaticMarkup(
          <FormPageHeader formId="frm_alpha" slug={SLUG} section={section} status="open" />,
        ),
      ),
    );

    expect(new Set(headings).size).toBe(SECTIONS.length);
  });

  // One catalog key feeds the heading and the last breadcrumb crumb, so a section cannot be
  // called one thing above the page and another in the trail leading to it.
  it.each(SECTIONS)(
    "names the %s section the same way in its breadcrumb crumb",
    (section, name) => {
      const markup = renderToStaticMarkup(
        <FormPageHeader formId="frm_alpha" slug={SLUG} section={section} status="open" />,
      );
      const crumbs = markup.slice(0, markup.indexOf("<h1"));

      expect(crumbs).toContain(name);
    },
  );

  it.each(SECTIONS)("serves the %s section from a route that takes the default", (section) => {
    const source = routeSource(ROUTE_FILES[section]);

    expect(source).toContain("<FormPageHeader");
    expect(source).not.toContain("heading=");
  });

  // The two child-entity routes name their own subject and are not touched by any of this
  // (issue #510). Their override still wins outright rather than being composed with a
  // section name, which would read "Version history: Version 3".
  it("leaves a route that overrides the heading holding exactly its override", () => {
    const markup = renderToStaticMarkup(
      <FormPageHeader
        formId="frm_alpha"
        slug={SLUG}
        section="versions"
        status="open"
        heading={{ id: "version-heading", text: "Version 3" }}
      />,
    );

    expect(headingText(markup)).toBe("Version 3");
  });
});

/**
 * The sixth sibling, pinned as correct rather than left to be discovered as inconsistent.
 *
 * `/forms/[formId]` is the one route of the six whose subject is the form itself, so its
 * `<h1>` is the bare slug and stays the bare slug. Nothing above reaches it, because it
 * renders no `FormPageHeader`; that is the point, and it is what these assertions hold in
 * place. A change that made the builder read "Builder: Life insurance" would be a
 * regression dressed as consistency, and it fails here.
 */
describe("the builder route keeps the bare slug on purpose (issue 679)", () => {
  it("hand-rolls its heading from the builder key and renders no FormPageHeader", () => {
    const source = routeSource("forms/[formId]/page.tsx");

    expect(source).toContain('"forms.builder.heading"');
    expect(source).not.toContain("FormPageHeader");
    expect(source).not.toContain("forms.section.heading");
  });

  it("resolves that key to the slug and nothing else", () => {
    expect(messages["forms.builder.heading"]).toBe("{slug}");
    expect(t("forms.builder.heading", { slug: SLUG })).toBe(SLUG);
  });
});
