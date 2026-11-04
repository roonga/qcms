import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DeliveryItem } from "../../lib/ops/types.ts";
import { stripTags } from "../test-support/markup.ts";

const { t, tPlural } = await import("../../lib/i18n/en.ts");
const { DeliveryRows } = await import("./delivery-dashboard.tsx");

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

function textOfTestId(html: string, testId: string): string {
  const match = new RegExp(`data-testid="${testId}"[^>]*>(.*?)</`, "s").exec(html);
  expect(match, `the render carries a ${testId} element`).not.toBeNull();
  return stripTags(match?.[1] ?? "");
}

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

    expect(textOfTestId(panel, "qcms-delivery-fact-status")).toBe(
      t("ops.deliveries.status.deadLettered"),
    );
    expect(textOfTestId(panel, "qcms-delivery-fact-attempts")).toBe("4");
    expect(textOfTestId(panel, "qcms-delivery-fact-latency")).toBe(
      t("ops.deliveries.latency", { ms: 1240 }),
    );
    expect(digest).toContain("1240");
    expect(digest).toContain("4");
    expect(facts + panel).toContain("1240");
  });

  it("carries the latency inside the panel at every width, not only where its cell survives", () => {
    const html = render(FAILED, true);
    const panel = panelOf(html);
    const summaryRow = html.slice(0, html.indexOf('data-testid="qcms-delivery-detail"'));

    expect(summaryRow).toContain("qcms-cell--drop");
    expect(panel).not.toContain("qcms-cell--drop");
    expect(textOfTestId(panel, "qcms-delivery-fact-latency")).toContain("1240");
  });

  it("heads the panel at h3, so the request headers below stop skipping a level (issue 541)", () => {
    const panel = panelOf(render(FAILED, true));

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
