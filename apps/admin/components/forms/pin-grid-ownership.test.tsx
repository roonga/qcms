import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import type { DraftForm, DraftStep, FormIssue, PinnableQuestion } from "../../lib/forms/types.ts";

const DEFINITION = {
  questionId: "q_at_fault_accident",
  type: "boolean" as const,
  label: { en: "Were you at fault?" },
};

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_at_fault_accident",
    slug: "at-fault-accident",
    label: { en: "Were you at fault?" },
    type: "boolean",
    versions: [
      { version: 1, status: "published", definition: DEFINITION },
      { version: 2, status: "published", definition: DEFINITION },
    ],
  },
  {
    questionId: "q_accident_count",
    slug: "accident-count",
    label: { en: "How many accidents?" },
    type: "number",
    versions: [{ version: 2, status: "published", definition: { ...DEFINITION, type: "number" } }],
  },
];

const STEP: DraftStep = {
  stepId: "stp_history",
  title: { en: "Driving history" },
  items: [
    { questionId: "q_at_fault_accident", version: 1 },
    { questionId: "q_accident_count", version: 2 },
  ],
};

const DRAFT: DraftForm = {
  formId: "frm_vehicle_insurance",
  defaultLocale: "en",
  title: { en: "Vehicle insurance" },
  steps: [STEP],
  rules: [],
};

async function render(step: DraftStep, issues: readonly FormIssue[] = []): Promise<string> {
  const { StepEditor } = await import("./step-editor.tsx");
  return renderToStaticMarkup(
    <StepEditor
      draft={DRAFT}
      step={step}
      library={{ ok: true, data: LIBRARY }}
      issues={issues}
      onAddPins={() => undefined}
      onMovePin={() => undefined}
      onRemovePin={() => undefined}
      onReorderPin={() => undefined}
      onAddGroup={() => undefined}
      onOpenGroup={() => undefined}
      onMoveGroup={() => undefined}
      onRemoveGroup={() => undefined}
    />,
  );
}

function cells(html: string): { attrs: string; inner: string }[] {
  const found: { attrs: string; inner: string }[] = [];
  const pattern = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let match = pattern.exec(html);
  while (match !== null) {
    found.push({ attrs: match[2] ?? "", inner: match[3] ?? "" });
    match = pattern.exec(html);
  }
  return found;
}

function cellsOwnedBy(html: string, owner: string): { attrs: string; inner: string }[] {
  return cells(html).filter((cell) => cell.attrs.includes(`data-owner="${owner}"`));
}

const VALUE_CONTROL = /<(?:input|select|textarea)\b|aria-haspopup=/;

beforeAll(async () => {
  await render(STEP);
}, 60_000);

describe("the pin list is an ownership grid", () => {
  it("draws every form-owned cell as a control", async () => {
    const html = await render(STEP);
    const owned = cellsOwnedBy(html, "form");

    expect(owned).toHaveLength(4);
    for (const cell of owned) {
      expect(cell.inner).toMatch(/<button\b/);
    }
  });

  it("draws every library-owned cell as text, with nothing in it that could change it", async () => {
    const html = await render(STEP);
    const owned = cellsOwnedBy(html, "library");

    expect(owned).toHaveLength(6);
    for (const cell of owned) {
      expect(cell.inner).not.toMatch(VALUE_CONTROL);
      for (const button of cell.inner.match(/<button\b[^>]*>/g) ?? []) {
        expect(button).toContain('data-readonly-action="copy"');
      }
    }
  });

  it("gives every cell an owner, so the split cannot be half-applied", async () => {
    const html = await render(STEP);
    const body = html.slice(html.indexOf("<tbody"));

    for (const cell of cells(body)) {
      expect(cell.attrs).toMatch(/data-owner="(?:form|library)"/);
    }
  });
});

describe("the identifying column follows contract section 2", () => {
  it("renders the question id whole, in the row, and never truncated", async () => {
    const html = await render(STEP);

    expect(html).toContain("q_at_fault_accident");
    expect(html).toContain("q_accident_count");
    expect(html).not.toContain("…");
    expect(html).not.toContain("text-overflow");
  });

  it("names the entity and the value on the copy control, not a bare 'Copy'", async () => {
    const html = await render(STEP);

    expect(html).toContain('aria-label="Copy question id q_at_fault_accident"');
    expect(html).toContain('aria-label="Copy question id q_accident_count"');
  });
});

describe("the pin list wears the table family", () => {
  it("is a plain table inside the qcms-table wrapper (contract section 2)", async () => {
    const html = await render(STEP);

    expect(html).toMatch(/<div class="qcms-table qcms-table--pins"><table>/);
    expect(html).not.toMatch(/<table class=/);
  });

  it("states its compact-width drops on the cells that drop, and not on Version", async () => {
    const html = await render(STEP);
    const dropped = cells(html).filter((cell) => cell.attrs.includes("qcms-cell--drop"));

    expect(dropped).toHaveLength(6);
    for (const cell of cells(html).filter((c) => c.attrs.includes("qcms-pincell--version"))) {
      expect(cell.attrs).not.toContain("qcms-cell--drop");
    }
  });

  it("renders the empty step as the one empty-state panel, not a bare paragraph", async () => {
    const html = await render({ ...STEP, items: [] });

    expect(html).toContain('data-testid="qcms-step-empty"');
    expect(html).toMatch(/<h2 class="qcms-empty__heading">/);
    expect(html).not.toContain("<table");
  });
});

describe("the row keeps its issue flag where the Issues column cannot follow", () => {
  it("marks the row itself, so a validation anchor still lands somewhere visible at 390", async () => {
    const issues: readonly FormIssue[] = [
      {
        code: "PIN_DEPRECATED",
        message: "Pinned to a deprecated version.",
        path: { question: "q_at_fault_accident" },
      },
    ];
    const html = await render(STEP, issues);

    expect(html).toMatch(
      /<tr class="qcms-pinrow is-error"[^>]*data-pin-question="q_at_fault_accident"/,
    );
    expect(html).toContain('data-issue-code="PIN_DEPRECATED"');
    expect(html).toContain('id="pin-q_at_fault_accident"');
  });
});
