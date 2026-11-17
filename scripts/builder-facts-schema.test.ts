import { describe, expect, it } from "vitest";

import {
  LAYOUT_ISSUES as ADMIN_LAYOUT_ISSUES,
  layoutFindings,
  layoutReportFact,
  selectionFact,
} from "../apps/admin/lib/agent/builder-facts.ts";
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

  it("shares the API's issue vocabulary", () => {
    expect([...ADMIN_LAYOUT_ISSUES]).toEqual([...LAYOUT_ISSUES]);
  });
});
