import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EntityId } from "./entity-id.tsx";
import { stripTags } from "./test-support/markup.ts";

/**
 * What an identifying cell actually renders (issue #582).
 *
 * `renderToStaticMarkup` IS the no-JavaScript render: server HTML, no hydration, no
 * handlers. So the assertions below are the no-JS claims themselves rather than proxies for
 * them, which matters here more than usual - §2 accepts a JS-only copy control **because**
 * the whole id is reachable without JavaScript, and the links and webhooks tables have no
 * detail route to carry it. This file is where that premise is checked.
 */

const SESSION = "ses_45cf634512ab9f0e77c1d2e3f4a5b6c7";

function markupOf(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

/**
 * The rendered text with tags removed, which is what a reader and a selection both get.
 *
 * Through `stripTags` rather than a regex of its own: a single-pass strip is the shape
 * CodeQL flags as `js/incomplete-multi-character-sanitization`, and the repository already
 * has one scanner for this (`components/test-support/markup.ts`).
 */
function textOf(markup: string): string {
  return stripTags(markup);
}

describe("an opaque id", () => {
  it("shows the type prefix and eight characters, and no ellipsis", () => {
    const markup = markupOf(<EntityId kind="session" value={SESSION} copy={false} />);
    expect(markup).toContain(">ses_45cf6345");
    expect(markup).not.toContain("…");
    expect(markup).not.toContain("...");
  });

  it("keeps the whole value in the server HTML, where a selection and a reader find it", () => {
    const markup = markupOf(<EntityId kind="session" value={SESSION} copy={false} />);
    expect(textOf(markup)).toBe(SESSION);
    // Clipped, not hidden: `.qcms-visually-hidden` stays in the accessibility tree, which
    // `display: none` would not. The width cost is the point of the abbreviation, and this
    // is what stops the abbreviation costing the value.
    expect(markup).toContain('<span class="qcms-visually-hidden">12ab9f0e77c1d2e3f4a5b6c7</span>');
  });

  it("carries a copy control naming the entity and the value it shows", () => {
    const markup = markupOf(<EntityId kind="session" value={SESSION} />);
    expect(markup).toContain('aria-label="Copy session id ses_45cf6345"');
    expect(markup).toMatch(/<button[^>]*class="qcms-copyid"/);
  });

  it("gets that control by default, because §2 requires one wherever an id is abbreviated", () => {
    expect(markupOf(<EntityId kind="link" value="lnk_3d9b8f2a1c9d4e07b31a" />)).toContain(
      "qcms-copyid",
    );
  });
});

describe("a derived id", () => {
  it("renders whole, with nothing hidden to recover", () => {
    const markup = markupOf(<EntityId kind="question" value="q_at_fault_accident" />);
    expect(textOf(markup)).toBe("q_at_fault_accident");
    expect(markup).not.toContain("qcms-visually-hidden");
  });

  it("carries no copy control unless the screen asks for one", () => {
    expect(markupOf(<EntityId kind="form" value="frm_life_insurance" />)).not.toContain(
      "qcms-copyid",
    );
    expect(markupOf(<EntityId kind="question" value="q_at_fault_accident" copy />)).toContain(
      'aria-label="Copy question id q_at_fault_accident"',
    );
  });
});

describe("an id that is its row's anchor", () => {
  it("puts the copy control beside the anchor, never inside it", () => {
    const markup = markupOf(
      <EntityId
        kind="session"
        value={SESSION}
        href="/forms/frm_x/responses/ses_45cf634512ab9f0e77c1d2e3f4a5b6c7"
        linkLabel={`Open response ${SESSION}`}
      />,
    );
    // Interactive content cannot nest, and a button inside an anchor is exactly that. The
    // anchor closes before the button opens.
    expect(markup.indexOf("</a>")).toBeLessThan(markup.indexOf("<button"));
    expect(markup).toContain(`aria-label="Open response ${SESSION}"`);
    expect(markup).toContain('href="/forms/frm_x/responses/ses_45cf634512ab9f0e77c1d2e3f4a5b6c7"');
  });

  it("names the destination in full, so the anchor identifies the row it opens", () => {
    // The accessible name carries the WHOLE id even though the cell shows eight characters
    // of it: the abbreviation is a width decision, and a row announced by a prefix would
    // be a row a screen-reader user cannot tell from another.
    const markup = markupOf(
      <EntityId kind="session" value={SESSION} href="/x" linkLabel={`Open response ${SESSION}`} />,
    );
    expect(markup).toContain(SESSION);
  });
});
