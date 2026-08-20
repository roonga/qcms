import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DeliveryItem } from "../../lib/ops/types.ts";

/**
 * Issue 519: the delivery dashboard's row trigger states what is behind it.
 *
 * `plan/admin-ux-audit.md` §3.8 approves the digest here because the disclosure mechanism
 * was already right; what it lacked was a statement of the record. §3.7 then binds the
 * digest: a fact stated on the trigger must also exist inside the panel, because a
 * disclosure that is shut has removed its content from the accessibility tree.
 *
 * ## Why this layer, and why `DeliveryRows` is exported for it
 *
 * The property is a relationship between the two halves of one disclosure, and the open
 * half is client state, so a static render of the dashboard can only ever produce the
 * closed one. `DeliveryRows` already takes `isOpen` as a prop, so rendering it at both
 * values is the whole comparison - no jsdom, no browser, and no reliance on a fixture
 * that has to be driven to a particular status first.
 *
 * The browser half of the coverage is elsewhere and stays there: `a11y-axe.pw.ts` opens a
 * real row and now runs `heading-order` over it with no register entry to excuse the
 * panel, and `docs/gates/pr-519/` carries the collapsed and expanded frames.
 *
 * ## The latency clause is the one that made the panel list necessary
 *
 * Status and attempts are also in row cells that are always present. Latency's cell
 * carries `qcms-cell--drop`, which is `display: none` below 40rem, so below that width the
 * trigger would have been the only surviving copy - a §3.7 breach that only exists at one
 * viewport and that nothing on a desktop run would have shown. The `This delivery` list
 * inside the panel is what closes it, and the last test here is what keeps it closed.
 *
 * ## Red-first
 *
 * Against the pre-change component (`red-vitest.log`): `DeliveryRows` is not exported at
 * all, so the file fails to import; with the export alone added, every digest and
 * `qcms-delivery-facts` assertion fails on a missing element, and the heading test finds
 * `<h4>` where it expects `<h3>` (that `<h4>`-under-`<h2>` skip is issue #541).
 */

vi.mock("@/components/empty-state", () => import("../empty-state.tsx"));
vi.mock("@/components/ops/ops-tags", () => import("./ops-tags.tsx"));
vi.mock("@/lib/i18n/format", () => import("../../lib/i18n/format.ts"));
vi.mock("@/lib/i18n/en", () => import("../../lib/i18n/en.ts"));
vi.mock("@/lib/ops/erasure", () => import("../../lib/ops/erasure.ts"));

const { t, tPlural } = await import("../../lib/i18n/en.ts");
const { DeliveryRows } = await import("./delivery-dashboard.tsx");

/** A dead-lettered delivery: the row an operator actually opens, with all three facts real. */
const FAILED: DeliveryItem = {
  deliveryId: "dlv_one",
  eventId: "evt_one",
  eventType: "response.submitted",
  webhookId: "wbk_one",
  url: "https://consumer.test/hook",
  status: "deadLettered",
  attempts: 4,
  lastError: "consumer said 503",
  createdAt: "2026-08-01T10:00:00.000Z",
  deliveredAt: null,
  deadLetteredAt: "2026-08-02T10:00:00.000Z",
  cancelledAt: null,
  cancelledReason: null,
  nextAttemptAt: "2026-08-02T11:00:00.000Z",
  lastAttemptAt: "2026-08-02T10:00:00.000Z",
  lastStatus: 503,
  latencyMs: 1240,
  requestHeaders: { "content-type": "application/json" },
  responseSnippet: "service unavailable",
  responseSnippetRedactedAt: null,
};

/** A delivery nothing has been tried on yet: no response, no latency to report. */
const UNATTEMPTED: DeliveryItem = {
  ...FAILED,
  deliveryId: "dlv_two",
  status: "pending",
  attempts: 0,
  lastError: null,
  deadLetteredAt: null,
  lastAttemptAt: null,
  lastStatus: null,
  latencyMs: null,
  requestHeaders: null,
  responseSnippet: null,
};

function render(row: DeliveryItem, isOpen: boolean): string {
  return renderToStaticMarkup(
    <table>
      <tbody>
        <DeliveryRows
          row={row}
          isOpen={isOpen}
          panelId={`qcms-delivery-detail-${row.deliveryId}`}
          onToggle={() => undefined}
        />
      </tbody>
    </table>,
  );
}

/** The text of one marked element, with tags inside it stripped. */
function textOfTestId(html: string, testId: string): string {
  const match = new RegExp(`data-testid="${testId}"[^>]*>(.*?)</`, "s").exec(html);
  expect(match, `the render carries a ${testId} element`).not.toBeNull();
  return (match?.[1] ?? "").replaceAll(/<[^<>]+>/g, "");
}

/** Just the disclosure panel: everything from the second `<tr>` onwards. */
function panelOf(html: string): string {
  const at = html.indexOf('data-testid="qcms-delivery-detail"');
  expect(at, "the open render carries the disclosure panel").toBeGreaterThan(-1);
  return html.slice(at);
}

describe("the delivery row trigger's digest (issue 519)", () => {
  it("states status, failed attempts and latency, as facts", () => {
    const digest = textOfTestId(render(FAILED, false), "qcms-delivery-digest");

    expect(digest).toContain(t("ops.deliveries.status.deadLettered"));
    expect(digest).toContain(
      tPlural("ops.deliveries.digest.attemptOne", "ops.deliveries.digest.attemptOther", 4),
    );
    expect(digest).toContain(t("ops.deliveries.latency", { ms: 1240 }));
  });

  it("drops latency from the sentence when there is no attempt to have measured one", () => {
    const digest = textOfTestId(render(UNATTEMPTED, false), "qcms-delivery-digest");

    expect(digest).toContain(t("ops.deliveries.status.pending"));
    expect(digest).toContain(
      tPlural("ops.deliveries.digest.attemptOne", "ops.deliveries.digest.attemptOther", 0),
    );
    // "none" here would read as a measurement rather than as the absence of one.
    expect(digest).not.toContain(t("ops.common.none"));
  });

  it("joins the accessible name of the trigger rather than sitting beside it", () => {
    const html = render(FAILED, false);
    const button = /<button[^>]*>(.*?)<\/button>/s.exec(html)?.[1] ?? "";

    expect(button).toContain(t("ops.deliveries.showDetail", { event: "response.submitted" }));
    expect(button).toContain('data-testid="qcms-delivery-digest"');
  });

  it("keeps every digested fact inside the panel as well (§3.7)", () => {
    const digest = textOfTestId(render(FAILED, false), "qcms-delivery-digest");
    const panel = panelOf(render(FAILED, true));
    const facts = textOfTestId(panel, "qcms-delivery-facts");

    // Each of the three, read back out of the panel's own list rather than argued for.
    expect(textOfTestId(panel, "qcms-delivery-fact-status")).toBe(
      t("ops.deliveries.status.deadLettered"),
    );
    expect(textOfTestId(panel, "qcms-delivery-fact-attempts")).toBe("4");
    expect(textOfTestId(panel, "qcms-delivery-fact-latency")).toBe(
      t("ops.deliveries.latency", { ms: 1240 }),
    );
    // And the digest states nothing the panel does not: 1240 and 4 both survive opening it.
    expect(digest).toContain("1240");
    expect(digest).toContain("4");
    expect(facts + panel).toContain("1240");
  });

  it("carries the latency inside the panel at every width, not only where its cell survives", () => {
    const html = render(FAILED, true);
    const panel = panelOf(html);
    const summaryRow = html.slice(0, html.indexOf('data-testid="qcms-delivery-detail"'));

    // The row cell is the one that goes: `qcms-cell--drop` is `display: none` below 40rem.
    expect(summaryRow).toContain("qcms-cell--drop");
    // The panel's copy carries no drop class, so it is the copy that holds at 390px.
    expect(panel).not.toContain("qcms-cell--drop");
    expect(textOfTestId(panel, "qcms-delivery-fact-latency")).toContain("1240");
  });

  it("heads the panel at h3, so the request headers below stop skipping a level (issue 541)", () => {
    const panel = panelOf(render(FAILED, true));

    // The dashboard's own heading is an `h2`. Before this change the panel's first heading
    // was the `<h4>` request-headers one, which is the gap that was registered in
    // `KNOWN_HEADING_ORDER_GAPS` and is deleted by this change.
    expect(panel).toMatch(/<h3[^>]*>/);
    expect(panel.indexOf("<h3")).toBeLessThan(panel.indexOf("<h4"));
    expect(panel).toContain(t("ops.deliveries.attemptSummary"));
  });

  it("states the three facts even on a row nothing has been attempted on", () => {
    const panel = panelOf(render(UNATTEMPTED, true));

    expect(textOfTestId(panel, "qcms-delivery-fact-status")).toBe(
      t("ops.deliveries.status.pending"),
    );
    expect(textOfTestId(panel, "qcms-delivery-fact-attempts")).toBe("0");
    expect(textOfTestId(panel, "qcms-delivery-fact-latency")).toBe(t("ops.common.none"));
    expect(panel).toContain(t("ops.deliveries.noAttempt"));
  });
});
