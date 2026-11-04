import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OperationsFormRail } from "./operations-form-rail.tsx";
import type { FormContext } from "../../lib/ops/form-contexts.ts";

function render(current: FormContext, held: readonly FormContext[]): string {
  return renderToStaticMarkup(
    <OperationsFormRail formId="frm_intake" name="intake" current={current} held={held} />,
  );
}

describe("the rail beside one form's operational screens", () => {
  it("offers every context an operator holds, in the rail's own order", () => {
    const html = render("responses", ["responses", "links", "webhooks", "intake"]);

    for (const context of ["responses", "links", "webhooks", "intake"]) {
      expect(html).toContain(`data-rail-item="section:${context}"`);
      expect(html).toContain(`/operations/forms/frm_intake/${context}`);
    }
  });

  it("offers a response viewer its responses and no other context", () => {
    const html = render("responses", ["responses"]);

    expect(html).toContain('data-rail-item="section:responses"');
    expect(html).not.toContain('data-rail-item="section:links"');
    expect(html).not.toContain('data-rail-item="section:webhooks"');
    expect(html).not.toContain('data-rail-item="section:intake"');
  });

  it("keeps the screen being served, so a refused cell read cannot empty the rail", () => {
    const html = render("links", []);

    expect(html).toContain('data-rail-item="section:links"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('data-rail-item="section:responses"');
  });
});
