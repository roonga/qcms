import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ConstraintsView, DefinitionIssue } from "../../lib/questions/types.ts";

import { ConstraintsEditor } from "./constraints-editor.tsx";

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

const V_INVALID = "^[A-Za-z][A-Za-z .,'-]{0,99}$";

describe("the pattern field surfaces the v-safe spelling (issue #53)", () => {
  it("suggests the normalized pattern when the authored one would be dropped", () => {
    const html = render({ pattern: V_INVALID });

    expect(html).toContain('data-testid="qcms-pattern-v-note"');
    expect(html).toContain("A browser reads the pattern attribute more strictly");
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
    const html = render({ pattern: "^[a-z-A]+$" });

    expect(html).toContain('data-testid="qcms-pattern-v-note"');
    expect(html).toContain("the in-page hint is lost");
  });

  it("says nothing on a frozen version, which cannot be edited anyway", () => {
    expect(render({ pattern: V_INVALID }, true)).not.toContain('data-testid="qcms-pattern-v-note"');
  });
});
