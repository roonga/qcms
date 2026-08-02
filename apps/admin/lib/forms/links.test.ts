import { describe, expect, it } from "vitest";

import { blankDraft } from "./draft.ts";
import { isRevocable, linkStateKey, mintedLinksCsv, mintedLinksFilename } from "./links.ts";
import { freezeSummary, nextVersion } from "./publish.ts";
import type { MintedLink } from "./types.ts";

/**
 * The secure-link and publish helpers (task 034).
 *
 * All pure: what the screen may say about a link's state, what a batch export looks like
 * when it reaches a spreadsheet, and what a publish confirmation claims it will freeze.
 * None of them decides anything the API decides.
 */

function minted(overrides: Partial<MintedLink> = {}): MintedLink {
  return {
    linkId: "lnk_one",
    url: "https://forms.example.test/l/abc.def",
    expiresAt: "2030-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("link state presentation", () => {
  it("names every state with its own catalog key", () => {
    const keys = (["active", "consumed", "expired", "revoked"] as const).map(linkStateKey);
    expect(new Set(keys).size).toBe(4);
  });

  it("offers revoke only for a link that is still a live door", () => {
    expect(isRevocable("active")).toBe(true);
    expect(isRevocable("consumed")).toBe(false);
    expect(isRevocable("expired")).toBe(false);
    expect(isRevocable("revoked")).toBe(false);
  });
});

describe("the batch CSV export", () => {
  it("writes a header and one CRLF-separated row per link", () => {
    const csv = mintedLinksCsv([minted(), minted({ linkId: "lnk_two" })]);
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe('"linkId","url","expiresAt"');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"lnk_one"');
    expect(lines[2]).toContain('"lnk_two"');
  });

  it("quotes a field that contains the separator, so no column can shift", () => {
    const csv = mintedLinksCsv([minted({ linkId: "lnk,with,commas" })]);
    expect(csv).toContain('"lnk,with,commas"');
    // Three fields, still: the commas are inside one quoted field.
    expect(csv.split("\r\n")[1]?.split('","')).toHaveLength(3);
  });

  it("doubles an embedded quote rather than ending the field early (RFC 4180)", () => {
    const csv = mintedLinksCsv([minted({ linkId: 'lnk_"quoted"' })]);
    expect(csv).toContain('"lnk_""quoted"""');
  });

  it("defuses a field a spreadsheet would execute on open", () => {
    // Formula injection: several spreadsheet programs evaluate a cell starting with one
    // of these. A minted URL never starts with `=`, and an export that would hand a
    // formula to an operator if one ever did is not one worth shipping.
    const csv = mintedLinksCsv([minted({ url: "=HYPERLINK(1)" })]);
    expect(csv).toContain("\"'=HYPERLINK(1)\"");
  });

  it("names the file after the form it belongs to, with nothing a path could use", () => {
    expect(mintedLinksFilename("frm_vehicle_insurance")).toBe("frm_vehicle_insurance-links.csv");
    expect(mintedLinksFilename("../../etc/passwd")).toBe("------etc-passwd-links.csv");
  });
});

describe("the publish confirmation's freeze summary", () => {
  it("counts steps, distinct pins and rules of the draft that would be frozen", () => {
    const draft = {
      ...blankDraft("frm_demo", "en"),
      steps: [
        { stepId: "stp_one", title: { en: "One" }, items: [{ questionId: "q_a", version: 1 }] },
        { stepId: "stp_two", title: { en: "Two" }, items: [{ questionId: "q_b", version: 2 }] },
      ],
      rules: [{ ruleId: "rul_a", when: { op: "answered" as const, questionId: "q_a" }, show: ["q_b"] }],
    };

    expect(freezeSummary(draft)).toEqual({ steps: 2, pins: 2, rules: 1 });
  });

  it("reads a form with no draft as nothing to freeze", () => {
    expect(freezeSummary(null)).toEqual({ steps: 0, pins: 0, rules: 0 });
  });

  it("names v1 for a form that has never been published", () => {
    expect(nextVersion(undefined)).toBe(1);
    expect(nextVersion(3)).toBe(4);
  });
});
