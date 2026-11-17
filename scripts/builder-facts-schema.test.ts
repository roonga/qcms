import { describe, expect, it } from "vitest";

import {
  LAYOUT_ISSUES as ADMIN_LAYOUT_ISSUES,
  layoutFindings,
  layoutReportFact,
  selectionFact,
} from "../apps/admin/lib/agent/builder-facts.ts";
import { previewRail } from "../apps/admin/lib/forms/preview-rail.ts";
import type { DraftForm } from "../apps/admin/lib/forms/types.ts";
import { railEntries } from "../apps/api/src/features/responses/serve-step/steps.ts";
import {
  LAYOUT_ISSUES,
  LayoutReportFact,
  PreviewSelectionFact,
} from "../apps/api/src/features/agent/schema.ts";

/* The admin builds both facts and the API's strict schemas are what a builder turn is held to, so
   the two are checked against each other here, where both apps are importable. */

describe("the admin's builder facts against the API's strict schemas", () => {
  it("passes a selection, with and without an instance", () => {
    const base = {
      formId: "frm_contact",
      stepId: "stp_one",
      questionId: "q_first_name",
      device: "phone",
      viewport: { width: 390, height: 844 },
    } as const;
    for (const fact of [selectionFact(base), selectionFact({ ...base, instanceId: "ins_p1" })]) {
      expect(fact).toBeDefined();
      expect(PreviewSelectionFact.safeParse(fact).error).toBeUndefined();
    }
  });

  it("passes a layout report with every kind of finding, at the bounds", () => {
    const findings = layoutFindings(
      [
        {
          questionId: "q_a",
          box: { left: -20, top: 0, right: 900, bottom: 80 },
          overflows: true,
          clipped: true,
          labelTruncated: true,
          smallTarget: true,
        },
        {
          questionId: "q_b",
          box: { left: 0, top: 40, right: 300, bottom: 120 },
          overflows: false,
          clipped: false,
          labelTruncated: false,
          smallTarget: false,
        },
      ],
      390,
    );
    expect(new Set(findings.map((finding) => finding.issue))).toEqual(new Set(LAYOUT_ISSUES));
    const fact = layoutReportFact({
      formId: "frm_contact",
      stepId: "stp_one",
      device: "custom",
      viewport: { width: 9_000, height: 10 },
      zoomPercent: 1_000,
      colorScheme: "light",
      highContrast: true,
      pageHeight: -4,
      findings,
    });
    expect(LayoutReportFact.safeParse(fact).error).toBeUndefined();
  });

  const selection = {
    formId: "frm_contact",
    stepId: "stp_one",
    questionId: "q_first_name",
    device: "phone",
    viewport: { width: 390, height: 844 },
  } as const;

  it.each([
    ["a form id that is not one", { formId: "contact" }],
    ["a step id that is not one", { stepId: "stp_One" }],
    ["a question id that is not one", { questionId: "first name" }],
    ["an instance id that is not one", { instanceId: "ins-1" }],
    ["an id past the slot's bound", { questionId: `q_${"a".repeat(130)}` }],
  ])("refuses a selection the API rejects: %s", (_case, change) => {
    const raw = { fact: "preview-selection", ...selection, ...change };
    expect(PreviewSelectionFact.safeParse(raw).success).toBe(false);
    expect(selectionFact({ ...selection, ...change })).toBeUndefined();
  });

  it("brings a selection's out-of-range viewport inside the API's bounds", () => {
    const viewport = { width: 120.4, height: 9_999 };
    expect(
      PreviewSelectionFact.safeParse({ fact: "preview-selection", ...selection, viewport }).success,
    ).toBe(false);
    const fact = selectionFact({ ...selection, viewport });
    expect(PreviewSelectionFact.safeParse(fact).error).toBeUndefined();
  });

  const report = {
    formId: "frm_contact",
    stepId: "stp_one",
    device: "desktop",
    viewport: { width: 1024, height: 768 },
    zoomPercent: 100,
    colorScheme: "light",
    highContrast: false,
    pageHeight: 1200,
    findings: [],
  } as const;

  it.each([
    ["a form id that is not one", { formId: "frm-contact" }],
    ["a step id that is not one", { stepId: "step_one" }],
  ])("refuses a layout report the API rejects: %s", (_case, change) => {
    const raw = { fact: "layout-report", orientation: "landscape", ...report, ...change };
    expect(LayoutReportFact.safeParse(raw).success).toBe(false);
    expect(layoutReportFact({ ...report, ...change })).toBeUndefined();
  });

  it.each([
    [
      "a 51st finding",
      {
        findings: Array.from({ length: 51 }, (_unused, at) => ({
          questionId: `q_${String(at)}`,
          issue: "clipped" as const,
        })),
      },
    ],
    [
      "a finding whose question id is not one",
      { findings: [{ questionId: "Q 1", issue: "clipped" as const }] },
    ],
    ["a zoom past the bounds", { zoomPercent: 401 }],
    ["a zoom below the bounds", { zoomPercent: 10 }],
    ["a fractional zoom", { zoomPercent: 99.5 }],
    ["a negative page height", { pageHeight: -1 }],
    ["a page height past the bounds", { pageHeight: 100_001 }],
    ["a viewport past the bounds", { viewport: { width: 4_001, height: 199 } }],
  ])("drops or bounds what the API rejects in a layout report: %s", (_case, change) => {
    const raw = { fact: "layout-report", orientation: "landscape", ...report, ...change };
    expect(LayoutReportFact.safeParse(raw).success).toBe(false);
    const fact = layoutReportFact({ ...report, ...change });
    expect(fact).toBeDefined();
    expect(LayoutReportFact.safeParse(fact).error).toBeUndefined();
  });

  it("shares the API's issue vocabulary", () => {
    expect([...ADMIN_LAYOUT_ISSUES]).toEqual([...LAYOUT_ISSUES]);
  });
});

describe("the admin's preview rail against the API's step rail", () => {
  const stepIds = ["stp_a", "stp_b", "stp_c", "stp_d"];
  const draft: DraftForm = {
    formId: "frm_rail",
    defaultLocale: "en",
    title: { en: "Rail" },
    rules: [],
    steps: stepIds.map((stepId) => ({ stepId, title: { en: stepId }, items: [] })),
  };

  function sequences(length: number): string[][] {
    if (length === 0) return [[]];
    return sequences(length - 1).flatMap((head) => stepIds.slice(0, 3).map((id) => [...head, id]));
  }

  it("agrees on every state and cursor for every view sequence and shown view", () => {
    let compared = 0;
    for (let length = 0; length <= 5; length += 1) {
      for (const ids of sequences(length)) {
        const views = ids.map((stepId) => ({ stepId: stepId as never, instanceId: null }));
        for (let shown = 0; shown <= length; shown += 1) {
          const api = railEntries({
            steps: stepIds as never[],
            views,
            servedIndex: shown,
            resumeIndex: shown,
          });
          const admin = previewRail(
            draft,
            ids.map((stepId) => ({ step: { stepId, root: null }, instanceId: null })),
            shown,
          );
          expect(
            admin.map(({ stepId, state, cursor }) => ({ stepId, state, cursor })),
            `${ids.join(",")} @${shown}`,
          ).toEqual(api.map(({ stepId, state, cursor }) => ({ stepId, state, cursor })));
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });
});
