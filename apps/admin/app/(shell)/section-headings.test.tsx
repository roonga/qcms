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
 * ## AMENDED 2026-08-26 (Code Owner): the section's name, and not the form's
 *
 * The heading was `"{section}: {slug}"` - "Links: kitchen-sink" - directly beneath a
 * breadcrumb reading "Forms / kitchen-sink / Links". It was a mashup of two crumbs a line
 * below them, and the form's identity is now on screen three times over: that breadcrumb,
 * the rail beside it, and the form id line under the heading itself.
 *
 * **679's fix is kept, because its defect was a different one.** All five section screens
 * used to render the SAME heading, the form's slug, so the one landmark heading a screen
 * reader navigates by answered "which form" rather than "which page" on every one of them.
 * Five DISTINCT headings is what that was for, and five section names are five distinct
 * headings. The test below that asserts they differ is the one carrying that property, and
 * it is unchanged.
 *
 * What this deviates from is the drawing: `preview-versions-poc.html` and
 * `responses-poc.html` compose both parts. They were drawn before this rail carried the
 * form's name on every one of these screens. Ruled on by the Code Owner rather than
 * transcribed, the same way 679 itself was - the two POCs disagreed on the connector, and
 * `forms.section.heading` was the string that resolved it. That string is now unused.
 *
 * ## The builder is the deliberate asymmetry, and this file pins it
 *
 * `/forms/[formId]` was exempt from this, and is no longer - see the last block, which
 * records the reversal and why the exemption's premise expired. What survives is that it
 * does not render `FormPageHeader` at all: it composes its own two-row header, carrying the
 * publish controls and the save state on the heading's row, and a later pass at consistency
 * routing it through the shared header would quietly take those with it.
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
const { messages } = await import("../../lib/i18n/en.ts");

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
  it.each(SECTIONS)("the %s section is headed '%s', and not the form's name", (section, name) => {
    const markup = renderToStaticMarkup(
      <FormPageHeader formId="frm_alpha" slug={SLUG} section={section} status="open" />,
    );

    // AMENDED 2026-08-26 (Code Owner): the section's name alone. It read
    // "{section}: {slug}", and the breadcrumb directly above says
    // "Forms / {slug} / {section}" - the heading was a mashup of two crumbs one line
    // below them. What 679 was actually for survives untouched and is asserted by the
    // next test: five screens, five DIFFERENT headings.
    expect(headingText(markup)).toBe(name);
    expect(headingText(markup), "the form's name is the breadcrumb's job").not.toContain(SLUG);
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
 * The sixth sibling, and its exemption is spent.
 *
 * REVERSED 2026-08-26 (Code Owner). Issue 679 exempted `/forms/[formId]` from naming its
 * section, on the reasoning that "the `<h1>` names the page's subject, and on the builder
 * the subject IS the form". That was true of one screen, and the builder is two now: this
 * route's form screen is the form's DETAILS, and its step screen heads itself with the
 * step. So the exemption's own premise no longer holds, and the slug it kept was being
 * repeated from the breadcrumb directly above it and from the rail beside it.
 *
 * What has NOT changed is that this route hand-rolls its heading rather than rendering
 * `FormPageHeader`: it composes its own two-row header, with the publish controls and the
 * save state on the heading's row. The assertions below still hold that in place, because
 * a later pass at consistency routing this screen through the shared header would quietly
 * take those with it.
 */
describe("the builder route names its screen, not its form (reversal of issue 679)", () => {
  it("renders no FormPageHeader, and heads itself from the client", () => {
    const source = routeSource("forms/[formId]/page.tsx");

    // The heading and the breadcrumb moved into `builder-breadcrumb.tsx` on 2026-08-26,
    // because this route is three screens and only the browser knows which one is showing:
    // the crumb said "Form details" while the reader was looking at a step's questions.
    // What is asserted here is what still belongs to the route file - that it composes its
    // own header rather than routing through the shared one, which would take the publish
    // controls and the save state with it.
    expect(source).toContain("BuilderBreadcrumb");
    expect(source).not.toContain('"forms.builder.heading"');
    expect(source).not.toContain("FormPageHeader");
    expect(source).not.toContain("forms.section.heading");
  });

  it("names every one of its screens from one lookup, so none can answer to two names", () => {
    // The crumb and the heading both call `currentScreenName`, and the rail's row for the
    // form calls the same key it returns for the form screen. Asserted as the strings,
    // because the defect this replaced was two lookups disagreeing: the rail read "Form
    // details" while the last crumb read "Builder".
    expect(messages["forms.tab.builder"]).toBe("Form details");
    expect(messages["forms.rail.rules"]).toBe("Rules");
  });
});
