import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ConstraintsView, DefinitionIssue } from "../../lib/questions/types.ts";

import { ConstraintsEditor } from "./constraints-editor.tsx";

/**
 * The pattern field offers the #52 normalization at the source (issue #53).
 *
 * A browser compiles the HTML `pattern` attribute under the regex `v` flag, whose
 * character-class grammar is narrower than the `u` semantics a question's validation
 * regex is authored and validated against. `^[A-Za-z][A-Za-z .,'-]{0,99}$` is the shape
 * that occurs throughout this repository's own corpus, and a browser drops it outright:
 * it logs "Pattern attribute value ... is not a valid regular expression" and loses the
 * native hint for that field. The renderer already repairs it on every render
 * (`toVSafePattern`); this note lets an author store the repaired spelling instead, so
 * nothing downstream has to repair anything.
 *
 * The Code Owner's ruling for #53 asked for a message-level suggestion rather than a new
 * widget, so what is asserted here is the sentence and the suggested pattern, not any
 * chrome around them.
 *
 * ## Why this layer
 *
 * `renderToStaticMarkup` sees the whole branch without a browser (ADR-23): the note is a
 * pure function of the pattern string, and driving it through Playwright would test
 * react-aria's text input rather than the decision this file is about.
 */

const NO_ISSUES: ReadonlyMap<string, DefinitionIssue[]> = new Map();

function render(constraints: ConstraintsView, isFrozen = false): string {
  return renderToStaticMarkup(
    <ConstraintsEditor
      type="shortText"
      constraints={constraints}
      onChange={() => undefined}
      issues={NO_ISSUES}
      isFrozen={isFrozen}
    />,
  );
}

/** The corpus shape: a trailing literal `-` inside a class, which `v` refuses. */
const V_INVALID = "^[A-Za-z][A-Za-z .,'-]{0,99}$";

describe("the pattern field surfaces the v-safe spelling (issue #53)", () => {
  it("suggests the normalized pattern when the authored one would be dropped", () => {
    const html = render({ pattern: V_INVALID });

    expect(html).toContain('data-testid="qcms-pattern-v-note"');
    expect(html).toContain("A browser reads the pattern attribute more strictly");
    // The suggestion is the normalization's own output, escaped for HTML: the same rule,
    // spelled so both engines read it the same way.
    expect(html).toContain("[A-Za-z .,&#x27;\\-]");
  });

  it("says nothing about a pattern a browser already accepts", () => {
    const html = render({ pattern: "^[a-z]{2,10}$" });

    expect(html).not.toContain('data-testid="qcms-pattern-v-note"');
  });

  it("says nothing when there is no pattern at all", () => {
    expect(render({})).not.toContain('data-testid="qcms-pattern-v-note"');
  });

  it("warns without a suggestion when the rewrite would not be provably safe", () => {
    // A mid-class dash the normalization deliberately declines to touch (it is neither
    // the first element nor the last, so escaping it could change the matched set), so
    // the renderer omits the attribute instead. The author is told the hint is lost
    // rather than handed a rewrite that might mean something else.
    const html = render({ pattern: "^[a-z-A]+$" });

    expect(html).toContain('data-testid="qcms-pattern-v-note"');
    expect(html).toContain("the in-page hint is lost");
  });

  it("says nothing on a frozen version, which cannot be edited anyway", () => {
    expect(render({ pattern: V_INVALID }, true)).not.toContain('data-testid="qcms-pattern-v-note"');
  });
});
