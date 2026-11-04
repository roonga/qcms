import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const { FormPageHeader } = await import("../../components/forms/form-page-header.tsx");
const { messages } = await import("../../lib/i18n/en.ts");

const SLUG = "Life insurance";

const SECTIONS = [
  ["rules", "Rules"],
  ["preview", "Preview"],
  ["versions", "Versions"],
  ["links", "Links"],
  ["responses", "Responses"],
  ["webhooks", "Webhooks"],
  ["intake", "Intake"],
] as const;

const ROUTE_FILES: Readonly<Record<(typeof SECTIONS)[number][0], string>> = {
  rules: "forms/[formId]/rules/page.tsx",
  preview: "forms/[formId]/preview/page.tsx",
  versions: "forms/[formId]/versions/page.tsx",
  links: "operations/forms/[formId]/links/page.tsx",
  responses: "operations/forms/[formId]/responses/page.tsx",
  webhooks: "operations/forms/[formId]/webhooks/page.tsx",
  intake: "operations/forms/[formId]/intake/page.tsx",
};

function routeSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

function headingText(markup: string): string {
  const match = /<h1[^>]*>([^<]*)<\/h1>/u.exec(markup);
  expect(match, "the header should render an h1").not.toBeNull();
  return match?.[1] ?? "";
}

describe("the section routes name their section in the h1 (issue 679)", () => {
  it.each(SECTIONS)("the %s section is headed '%s', and not the form's name", (section, name) => {
    const markup = renderToStaticMarkup(
      <FormPageHeader formId="frm_alpha" section={section} status="open" />,
    );

    expect(headingText(markup)).toBe(name);
    expect(headingText(markup), "the form's name is the rail Header's job").not.toContain(SLUG);
  });

  it("gives the sections a different heading each, which was the defect", () => {
    const headings = SECTIONS.map(([section]) =>
      headingText(
        renderToStaticMarkup(<FormPageHeader formId="frm_alpha" section={section} status="open" />),
      ),
    );

    expect(new Set(headings).size).toBe(SECTIONS.length);
  });

  it.each(SECTIONS)("names the %s section without a trail above it", (section, name) => {
    const markup = renderToStaticMarkup(
      <FormPageHeader formId="frm_alpha" section={section} status="open" />,
    );

    expect(markup.slice(0, markup.indexOf("<h1")), "nothing leads the heading").not.toContain(name);
    expect(markup).not.toContain("<nav");
    expect(markup).not.toContain("qcms-visually-hidden");
  });

  it.each(SECTIONS)("serves the %s section from a route that takes the default", (section) => {
    const source = routeSource(ROUTE_FILES[section]);

    expect(source).toContain("<FormPageHeader");
    expect(source).not.toContain("heading=");
  });

  it("leaves a route that overrides the heading holding exactly its override", () => {
    const markup = renderToStaticMarkup(
      <FormPageHeader
        formId="frm_alpha"
        section="versions"
        status="open"
        heading={{ id: "version-heading", text: "Version 3" }}
      />,
    );

    expect(headingText(markup)).toBe("Version 3");
  });
});

describe("the builder route names its screen, not its form (reversal of issue 679)", () => {
  it("renders no FormPageHeader, and heads itself from the client", () => {
    const source = routeSource("forms/[formId]/page.tsx");

    expect(source).not.toContain("BuilderBreadcrumb");
    expect(source).not.toContain("Breadcrumb");
    expect(source).not.toContain('"forms.builder.heading"');
    expect(source).not.toContain("FormPageHeader");
    expect(source).not.toContain("forms.section.heading");
  });

  it("names every one of its screens from one lookup, so none can answer to two names", () => {
    expect(messages["forms.tab.builder"]).toBe("Form details");
    expect(messages["forms.tab.rules"]).toBe("Rules");
  });
});
