import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import PortalError from "../../pages/_error";

/**
 * The portal's error page (task 073, reviewed on PR #1034, finding 2).
 *
 * Rendered to static markup, which is the whole of what a respondent without JavaScript
 * receives, and asserted on its WORDS: this page is the only message that reaches someone
 * whose page went stale across a deploy, so what it says is the deliverable. The browser
 * suite cannot cover it, because Next replaces the error component with its own overlay
 * driver in development and only serves this file from a production build; the full-stack
 * suite asserts it against the deployed stack, and this holds the content on every run.
 */
describe("the portal's error page", () => {
  const markup = (statusCode?: number): string =>
    renderToStaticMarkup(createElement(PortalError, { statusCode }));

  it("tells a respondent what happened, what is kept, and what is lost", () => {
    const html = markup(500);
    expect(html).toContain("This page was out of date");
    // Each of the three facts the Code Owner's ruling of 2026-10-02 names. They are
    // asserted as substrings of the shipped wording rather than by key, so a reword that
    // drops one of them fails here.
    expect(html).toContain("was not made");
    expect(html).toContain("is kept");
    expect(html).toContain("typing again");
  });

  it("offers one way onward, and it is a RELATIVE link", () => {
    // Relative, so the browser resolves it against the URL the respondent is on, which
    // for this failure is the step's own path: a GET that re-reads the step from the API.
    // An absolute path could not know the session, and this page must not: it is handed
    // nothing but a status code and writes nothing about the session into the markup.
    const html = markup(500);
    expect(html).toContain('href="."');
    expect(html).not.toMatch(/ses_[0-9a-f]/);
  });

  it("says something else entirely for a 404", () => {
    const html = markup(404);
    expect(html).toContain("This page does not exist");
    expect(html).not.toContain("This page was out of date");
  });

  it("falls back to the skew wording when it is handed no status at all", () => {
    expect(markup(undefined)).toContain("This page was out of date");
  });
});
