import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issues 572 and 544: the four remaining `ok ? data : []` sites, one per read.
 *
 * Issue 544 filed the pattern - a `Result`-shaped read unwrapped with `ok ? data : []`, so
 * a failed read arrives at the component as a successful empty one and the screen renders
 * its zero-items state about data it never saw. Issue 572 holds the concrete list and the
 * reason it got worse: after issue 514 the zero-items state is no longer a muted sentence
 * but §3's panel, a centred dashed surface with an `h2` and, where the screen has a
 * creating action, a primary call to action.
 *
 * Four sites were still open on `main` when this file was written (the other four named
 * across the two issues were closed by issues 513, 514, 543 and 521):
 *
 * 1. `forms/[formId]/webhooks/page.tsx` -> `WebhookConfig`
 * 2. `forms/[formId]/webhooks/page.tsx` -> `DeliveryDashboard`
 * 3. `forms/[formId]/links/page.tsx` -> `SecureLinks`
 * 4. `forms/[formId]/page.tsx` -> `FormBuilder`
 *
 * All four now hand the component a `ReadState` (`lib/read-state.ts`, issue 543), and each
 * decides for itself what a failure suppresses. The rule being applied is the one issue
 * 521 derived at the response browser and this file asserts at each site: "and nothing
 * else" means nothing that CLAIMS anything about the failed read. Chrome that stays true
 * is fine, including a creating action that still works. So each block below has a
 * failure test that pins BOTH halves - what went, and what stayed - plus an empty-read
 * control, because a fix that deleted the empty state instead of gating it would pass a
 * one-sided test and break §3 from the other direction.
 *
 * ## Why this layer, and not Playwright
 *
 * The same argument `forms-list-states.test.tsx` and `empty-and-table-states.test.tsx`
 * give, and it is structural rather than a preference. These reads run in the Next
 * **server** process, so `page.route()` never sees the request and no browser gesture can
 * make `listWebhooks` fail; `playwright.config.ts` records the underlying constraint (a
 * `webServer` cannot be booted twice with two environments). Rendering the server
 * component with its read stubbed and asserting over the HTML it emits is the highest
 * layer that can reach the failure branch at all (ADR-23).
 *
 * A sibling file rather than more blocks in `empty-and-table-states.test.tsx`, because
 * these four screens need a much wider `@/components/kit` stand-in and a set of bound
 * server actions that file has no use for.
 *
 * ## What this layer cannot reach
 *
 * Two of the claims corrected for the builder live behind a control the operator has to
 * press: the library picker's "no published version matches this search" panel is inside a
 * dialog opened from step state, and the move-pin menu's "No other published version" is
 * inside a popover. A static render of the page reaches neither. The menu is asserted
 * below by rendering `StepEditor` directly with a `MenuPopover` stand-in that renders its
 * children, which is what the real popover renders once opened. The picker's failure copy
 * is not asserted anywhere at this layer, and that is stated rather than hidden.
 */

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

const FORM_DETAIL = {
  formId: "frm_one",
  slug: "one",
  defaultLocale: "en",
  status: "open",
  draftSource: "open",
  versions: [{ version: 1, status: "published", publishedAt: "2026-08-01T10:00:00.000Z" }],
  settings: { challengeRequired: false, minSubmitMs: null },
  challengeEnforceable: false,
  draft: {
    formId: "frm_one",
    defaultLocale: "en",
    title: { en: "One" },
    steps: [
      {
        stepId: "stp_one",
        title: { en: "Step one" },
        items: [{ questionId: "q_one", version: 1 }],
      },
    ],
    rules: [],
  },
};

const WEBHOOK = {
  webhookId: "whk_one",
  url: "https://example.test/hook",
  active: true,
  deactivatedAt: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
};

const DELIVERY = {
  deliveryId: "dlv_one",
  eventId: "evt_one",
  eventType: "response.submitted",
  webhookId: "whk_one",
  url: "https://example.test/hook",
  status: "delivered",
  attempts: 0,
  lastError: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  deliveredAt: "2026-08-01T10:00:00.000Z",
  deadLetteredAt: null,
  cancelledAt: null,
  cancelledReason: null,
  nextAttemptAt: "2026-08-01T10:00:00.000Z",
  lastAttemptAt: "2026-08-01T10:00:00.000Z",
  lastStatus: 200,
  latencyMs: 120,
  requestHeaders: null,
  responseSnippet: null,
};

const LINK = {
  linkId: "lnk_one",
  state: "active",
  oneTime: false,
  expiresAt: "2026-09-01T10:00:00.000Z",
  consumedAt: null,
  revokedAt: null,
  createdAt: "2026-08-01T10:00:00.000Z",
};

/** Set per test before the page module is imported; each page reads once, at render. */
let formDetailResult: unknown = { ok: true, data: FORM_DETAIL };
let webhooksResult: unknown = { ok: true, data: [] };
let deliveriesResult: unknown = { ok: true, data: [] };
let linksResult: unknown = { ok: true, data: [] };
let libraryResult: unknown = { ok: true, data: [] };

/**
 * The subjects are redirected to the real modules rather than stubbed, for the reason
 * `empty-and-table-states.test.tsx` gives: a stand-in shaped like the thing under test
 * only asserts that the stand-in is shaped like the thing under test. `EmptyState` is
 * §3's panel and is what "no empty claim" is measured against, and `read-state` is the
 * contract itself.
 */
vi.mock("@/components/ops/webhook-config", () => import("../../components/ops/webhook-config"));
vi.mock(
  "@/components/ops/delivery-dashboard",
  () => import("../../components/ops/delivery-dashboard"),
);
vi.mock("@/components/forms/secure-links", () => import("../../components/forms/secure-links"));
vi.mock("@/components/forms/form-builder", () => import("../../components/forms/form-builder"));
// The seam the builder publishes its steps through, for the rail beside it.
vi.mock("@/lib/forms/builder-bridge", () => import("../../lib/forms/builder-bridge"));
vi.mock("@/components/empty-state", () => import("../../components/empty-state"));
vi.mock("@/lib/read-state", () => import("../../lib/read-state"));
vi.mock("@/lib/i18n/format", () => import("../../lib/i18n/format"));
vi.mock("@/lib/questions/definition", () => import("../../lib/questions/definition"));
vi.mock("@/lib/forms/links", () => import("../../lib/forms/links"));
vi.mock("@/lib/forms/draft", () => import("../../lib/forms/draft"));
vi.mock("@/lib/forms/picker-selection", () => import("../../lib/forms/picker-selection"));
vi.mock("@/lib/forms/issues", () => import("../../lib/forms/issues"));
vi.mock("@/lib/forms/condition", () => import("../../lib/forms/condition"));
vi.mock("@/components/searchable-select", () => import("../../components/searchable-select"));
vi.mock("@/lib/forms/pin-grid", () => import("../../lib/forms/pin-grid"));
vi.mock("@/lib/forms/settings", () => import("../../lib/forms/settings"));
vi.mock("@/components/row-menu", () => import("../../components/row-menu"));
vi.mock("@/lib/announce", () => ({ announce: () => undefined }));
vi.mock("@/lib/forms/types", () => import("../../lib/forms/types"));
vi.mock("@/lib/forms/builder-state", () => import("../../lib/forms/builder-state"));
vi.mock("@/components/forms/link-state-tag", () => import("../../components/forms/link-state-tag"));
vi.mock("@/components/ops/ops-tags", () => ({
  cancelledReasonText: (reason: string) => reason,
  DeliveryStatusTag: () => <span data-testid="qcms-delivery-status-stub" />,
  erasureReasonText: (reason: string) => reason,
  FlagTag: () => <span data-testid="qcms-flag-tag-stub" />,
}));
vi.mock("@/components/forms/form-page-header", () => ({
  FormPageHeader: () => <div data-testid="qcms-form-page-header-stub" />,
}));
vi.mock("@/components/save-model", () => ({
  AmbientSaveStatus: () => <div data-testid="qcms-save-status-stub" />,
  ManualSaveNote: () => <p data-testid="qcms-save-note-stub" />,
}));
vi.mock("@/components/forms/form-actions", () => ({
  FormActions: () => <div data-testid="qcms-form-actions-stub" />,
}));
// Stubbed like the actions beside it: this file is about what the page hands the builder
// when a read fails, and the public link is neither read nor affected by one. Its own
// behaviour is asserted in `lib/forms/public-link.test.ts`, which is where the decision
// about when a link exists at all actually lives.
vi.mock("@/components/forms/public-form-link", () => ({
  PublicFormLink: () => <div data-testid="qcms-public-link-stub" />,
}));
// The breadcrumb reads the builder bridge to name the screen the reader is on, which a
// static render of the page has no builder to publish to. Stubbed like the actions beside
// it: this file is about what a failed READ does, and the crumb is neither read nor
// affected by one.
vi.mock("@/components/forms/builder-breadcrumb", () => ({
  BuilderBreadcrumb: () => <nav data-testid="qcms-breadcrumb-stub" />,
  currentScreenName: () => "Form details",
}));
// The page reads the portal's origin to build a published form's public address. Absent
// here, which is a real deployment state and the one that renders nothing: this file is
// about what a FAILED READ does to the builder, and the link is neither read nor affected.
vi.mock("@/lib/server/config", () => ({ portalBaseUrl: () => undefined }));
// Redirected to the real module rather than stubbed: it is a pure function and this file
// wants the page's real answer about whether a link exists, not a fixed one.
vi.mock("@/lib/forms/public-link", () => import("../../lib/forms/public-link.ts"));
// The rules table writes an issue count the way the rail's step rows write theirs, which
// is why it reaches for the rail's helper. Redirected to the real module: it is a pure
// pluralisation and this file wants the real words.
vi.mock("@/lib/forms/subtree-rail", () => import("../../lib/forms/subtree-rail.ts"));
vi.mock("@/lib/forms/rule-sentence", () => import("../../lib/forms/rule-sentence.ts"));
vi.mock("@/lib/forms/rule-targets", () => import("../../lib/forms/rule-targets.ts"));
// Pure cookie helpers, redirected to the real module: this file wants the page's real
// answer about whether the concurrent notice has been dismissed, which with no cookie on
// the request is "no".
vi.mock("@/lib/builder-notice", () => import("../../lib/builder-notice.ts"));
vi.mock("@/lib/ops/unexpected", () => ({ unexpected: () => "ops.error.unexpected" }));

// The page reads one cookie - whether the concurrent-edit notice has been dismissed - and
// `cookies()` throws outside a request scope, which a direct render of the page is. An
// empty jar is the honest stand-in: it is what a first visit sends, and it is the branch
// that renders the notice, so nothing here is hidden by the stub.
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/forms", () => ({
  getForm: () => Promise.resolve(formDetailResult),
  loadPinnableQuestions: () => Promise.resolve(libraryResult),
}));
vi.mock("@/lib/server/webhook-ops", () => ({
  listWebhooks: () => Promise.resolve(webhooksResult),
  listDeliveries: () => Promise.resolve(deliveriesResult),
}));
vi.mock("@/lib/server/links", () => ({
  listLinks: () => Promise.resolve(linksResult),
  MAX_LINK_BATCH: 100,
}));

const NOOP_ACTION = () => Promise.resolve({ status: "idle" });

vi.mock("./webhooks/actions", () => ({
  createWebhookAction: NOOP_ACTION,
  deactivateWebhookAction: NOOP_ACTION,
  reactivateWebhookAction: NOOP_ACTION,
  retargetWebhookAction: NOOP_ACTION,
  rotateSecretAction: NOOP_ACTION,
}));
vi.mock("./forms/actions", () => ({
  mintLinksAction: NOOP_ACTION,
  revokeLinkAction: NOOP_ACTION,
  previewConditionAction: NOOP_ACTION,
  publishFormAction: NOOP_ACTION,
  saveDraftAction: NOOP_ACTION,
  setFormStatusAction: NOOP_ACTION,
  updateSettingsAction: NOOP_ACTION,
  validateDraftAction: NOOP_ACTION,
}));

/**
 * `t` answers with its own key, so every assertion is about WHICH string a branch chose
 * rather than about the sentence it holds today. That is what makes "the failed read does
 * not print the empty sentence" a precise claim rather than a substring guess.
 */
vi.mock("@/lib/i18n/en", () => ({
  t: (key: string) => key,
  tPlural: (one: string) => one,
}));

/**
 * Marked stand-ins, so the real controls' markup never confuses the assertions.
 *
 * `MenuPopover` renders its children, which the real one does only once opened. That is
 * the point for the move-pin block below: the popover's contents are what an operator
 * reads after pressing the trigger, and this is the only layer that can read them at all.
 */
vi.mock("@/components/kit", () => ({
  Alert: ({ variant, children }: { variant?: string; children?: ReactNode }) => (
    <div data-testid="qcms-alert" data-variant={variant}>
      {children}
    </div>
  ),
  Breadcrumb: () => <nav data-testid="qcms-breadcrumb-stub" />,
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  Card: ({ children }: { children?: ReactNode }) => (
    <div data-testid="qcms-card-stub">{children}</div>
  ),
  Checkbox: () => <input aria-label="stub" type="checkbox" />,
  DatePicker: () => <input aria-label="stub" type="date" />,
  Dialog: ({ children }: { children?: ReactNode }) => (
    <div data-testid="qcms-dialog-stub">{children}</div>
  ),
  Form: ({ children }: { children?: ReactNode }) => <form>{children}</form>,
  MenuItem: ({ children }: { children?: ReactNode }) => <li>{children}</li>,
  MenuList: ({ children }: { children?: ReactNode }) => <ul>{children}</ul>,
  MenuPopover: ({ children }: { children?: ReactNode }) => (
    <div data-testid="qcms-menu-popover-stub">{children}</div>
  ),
  MenuSeparator: () => <hr />,
  MenuTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  MenuTriggerButton: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  NumberField: () => <input aria-label="stub" type="number" />,
  Select: () => <select aria-label="stub" />,
  Table: () => <div data-testid="qcms-kit-table-stub" />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  TextField: () => <input aria-label="stub" />,
}));

/** The panel §3 prescribes, and the `h2` it must contain. */
const EMPTY_PANEL = /<div class="qcms-empty"[^>]*>/;
const EMPTY_HEADING = /<h2 class="qcms-empty__heading">/;

async function renderFormWebhooks(): Promise<string> {
  const { default: Page } = await import("./forms/[formId]/webhooks/page.tsx");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ formId: "frm_one" }) }));
}

async function renderLinks(): Promise<string> {
  const { default: Page } = await import("./forms/[formId]/links/page.tsx");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ formId: "frm_one" }) }));
}

async function renderBuilder(): Promise<string> {
  const { default: Page } = await import("./forms/[formId]/page.tsx");
  return renderToStaticMarkup(
    await Page({
      params: Promise.resolve({ formId: "frm_one" }),
      searchParams: Promise.resolve({}),
    }),
  );
}

beforeEach(() => {
  formDetailResult = { ok: true, data: FORM_DETAIL };
  webhooksResult = { ok: true, data: [] };
  deliveriesResult = { ok: true, data: [] };
  linksResult = { ok: true, data: [] };
  libraryResult = { ok: true, data: [] };
});

/**
 * The site issue 572 leads with, and the one where the false claim is loudest: a prominent
 * "No endpoint yet" panel with a primary **Add endpoint** button, directly beneath an
 * alert saying the endpoint list could not be loaded.
 *
 * The creating action survives the failure and that is not an oversight: this page's own
 * comment already required that `WebhookConfig` keep offering creation when the list read
 * fails, because an operator who cannot load the existing endpoints may still legitimately
 * need to add one. Suppressing the whole component would remove a working capability
 * because a different read failed, which is the mistake issue 521's first attempt made and
 * reverted before landing.
 */
describe("the per-form webhook config's read states (issues 572, 544)", () => {
  it("makes no claim about endpoints when the list read fails", async () => {
    webhooksResult = { ok: false, message: "upstream said 503" };

    const html = await renderFormWebhooks();

    expect(html).toContain('data-testid="qcms-alert"');
    expect(html).toContain("ops.webhooks.listFailed");
    // `ops.webhooks.emptyTitle` starts with `ops.webhooks.empty`, so one assertion rules
    // out both halves of the panel's copy.
    expect(html).not.toContain("ops.webhooks.empty");
    expect(html).not.toContain('data-testid="qcms-webhooks-empty"');
    expect(html).not.toContain('data-testid="qcms-webhooks-table"');
  });

  it("keeps the heading and the creating action when the list read fails", async () => {
    webhooksResult = { ok: false, message: "upstream said 503" };

    const html = await renderFormWebhooks();

    // The alert needs a subject, and a heading claims nothing.
    expect(html).toContain('id="qcms-webhooks-heading"');
    // Creation does not depend on the list that failed, so it stays - and stays exactly
    // once, because the panel that would otherwise carry the same accessible name is
    // suppressed.
    expect(html.match(/ops\.webhooks\.add/g)).toHaveLength(1);
  });

  it("still renders the empty panel when the form genuinely has no endpoint", async () => {
    const html = await renderFormWebhooks();

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toMatch(EMPTY_HEADING);
    expect(html).toContain('data-testid="qcms-webhooks-empty"');
    expect(html).toContain("ops.webhooks.emptyTitle");
    // §3's CTA, and the only control on the screen offering it: the standalone button
    // stands down in this one state rather than repeating the panel's accessible name.
    expect(html.match(/ops\.webhooks\.add/g)).toHaveLength(1);
  });

  it("renders one family table, wrapped, when the form has an endpoint", async () => {
    webhooksResult = { ok: true, data: [WEBHOOK] };

    const html = await renderFormWebhooks();

    expect(html).toContain('<div class="qcms-table"><table');
    expect(html).toContain('data-testid="qcms-webhooks-table"');
    // Scoped to this section's own panel: the delivery dashboard below is separately
    // empty in this case, so a bare `EMPTY_PANEL` assertion would be reading its markup.
    expect(html).not.toContain('data-testid="qcms-webhooks-empty"');
  });
});

/**
 * The second site on the same page, and the one where the false claim is the reassuring
 * one: an operator chasing a webhook a consumer says never arrived would read "Nothing has
 * been delivered for this form yet." as the answer.
 *
 * Nothing is kept here beyond the heading and intro, and that is the right answer rather
 * than an inconsistency with the block above: this screen has no creating action at all,
 * because deliveries are made by the system when a response is submitted.
 */
describe("the delivery dashboard's read states (issues 572, 544)", () => {
  it("makes no claim about deliveries when the read fails", async () => {
    deliveriesResult = { ok: false, message: "upstream said 503" };

    const html = await renderFormWebhooks();

    expect(html).toContain("ops.deliveries.loadFailed");
    expect(html).not.toContain("ops.deliveries.emptyTitle");
    expect(html).not.toContain('data-testid="qcms-deliveries-empty"');
    expect(html).not.toContain('data-testid="qcms-deliveries-table"');
    // The alert needs a subject, and a heading claims nothing.
    expect(html).toContain('id="qcms-deliveries-heading"');
  });

  it("still renders the empty panel when the form genuinely has no delivery", async () => {
    const html = await renderFormWebhooks();

    expect(html).toContain('data-testid="qcms-deliveries-empty"');
    expect(html).toContain("ops.deliveries.emptyTitle");
    expect(html).not.toContain("ops.deliveries.loadFailed");
  });

  it("renders one family table, wrapped, when the form has a delivery", async () => {
    deliveriesResult = { ok: true, data: [DELIVERY] };

    const html = await renderFormWebhooks();

    expect(html).toContain('data-testid="qcms-deliveries-table"');
    expect(html).not.toContain('data-testid="qcms-deliveries-empty"');
  });
});

/**
 * The secure-link screen. "No links have been minted for this form." underneath a warning
 * that the link list could not be loaded tells an author the links they minted an hour ago
 * are gone, and the natural response to that is to mint more.
 *
 * Minting survives, for the same reason creation survives on the webhook screen and for
 * one this page states itself: whether this form can mint is decided by its published
 * versions, which came from the form read, not from the list read that failed.
 */
describe("the secure-link list's read states (issues 572, 544)", () => {
  it("makes no claim about links when the list read fails", async () => {
    linksResult = { ok: false, message: "upstream said 503" };

    const html = await renderLinks();

    expect(html).toContain('data-testid="qcms-alert"');
    expect(html).toContain("forms.links.listFailed");
    // `forms.links.emptyTitle` starts with `forms.links.empty`, so one assertion rules out
    // both halves of the panel's copy.
    expect(html).not.toContain("forms.links.empty");
    expect(html).not.toContain('data-testid="qcms-links-empty"');
    expect(html).not.toContain('data-testid="qcms-links-table"');
  });

  it("keeps the heading and the mint control when the list read fails", async () => {
    linksResult = { ok: false, message: "upstream said 503" };

    const html = await renderLinks();

    expect(html).toContain('id="qcms-links-heading"');
    // Minting is a separate write and this form has a published version, so the control
    // stays and the "publish first" note stays away.
    expect(html).toContain("forms.links.mint");
    expect(html).not.toContain('data-testid="qcms-links-needs-publish"');
  });

  it("still renders the empty panel when the form genuinely has no link", async () => {
    const html = await renderLinks();

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toMatch(EMPTY_HEADING);
    expect(html).toContain('data-testid="qcms-links-empty"');
    expect(html).toContain("forms.links.emptyTitle");
    expect(html).not.toContain('data-testid="qcms-alert"');
  });

  it("renders one family table, wrapped, when the form has a link", async () => {
    linksResult = { ok: true, data: [LINK] };

    const html = await renderLinks();

    expect(html).toContain('<div class="qcms-table"><table');
    expect(html).toContain('data-testid="qcms-links-table"');
    expect(html).not.toMatch(EMPTY_PANEL);
  });
});

/**
 * The builder, where the symptom is not §3's panel and had to be assessed rather than
 * assumed (issue 544 asks for exactly that, having found this site by grep).
 *
 * An empty question library is not a neutral stand-in on this screen: every pin lookup
 * misses against one. So `ok ? data : []` tagged EVERY pinned question in the form
 * "Version not found" and "No label in the library" - claims about the library, printed
 * on every row beneath the page's own warning that the library could not be loaded, and
 * together read as "this form has been gutted".
 *
 * The four answers themselves are asserted where they are decided, in
 * `lib/forms/pin-grid.test.ts` (issue 517 moved the grid's view model into a pure
 * helper). What is asserted HERE is the wiring the page owns: that the page hands the
 * builder a failed `ReadState` at all, and that the whole builder survives it.
 *
 * ## Why the pin assertions render the step editor rather than the page
 *
 * The builder became two screens on 2026-08-26 - the form's own details, and one step -
 * and the rail switches between them. It opens on the form, which the drawing has current,
 * so a static render of the page reaches the form screen and never the pin grid. Nor can a
 * gesture take it there: the switch lives in the `@rail` slot, a different React tree that
 * this render does not include, so there is no control inside this markup to press.
 *
 * The same answer the move-pin block below already gives, for the same reason it gives it:
 * render `StepEditor` with the `ReadState` the page resolved. What that costs is stated
 * rather than hidden - the page-to-builder-to-editor chain is no longer covered end to end
 * at this layer, so the page half is asserted through what the page itself renders (the
 * warning, and the absence of any library claim on the form screen) and the editor half
 * through the value the page computes. `e2e/questions-lifecycle.pw.ts` crosses the whole
 * chain in a browser, where the rail exists and can be clicked.
 */
describe("the form builder's library read states (issues 572, 544)", () => {
  async function renderPinGrid(): Promise<string> {
    const { StepEditor } = await import("../../components/forms/step-editor");
    const { readState } = await import("../../lib/read-state");
    return renderToStaticMarkup(
      <StepEditor
        draft={FORM_DETAIL.draft}
        step={FORM_DETAIL.draft.steps[0] as never}
        library={readState(libraryResult as never) as never}
        issues={[]}
        onAddPins={() => undefined}
        onMovePin={() => undefined}
        onRemovePin={() => undefined}
        onReorderPin={() => undefined}
      />,
    );
  }

  it("makes no claim about the pinned versions when the library read fails", async () => {
    libraryResult = { ok: false, message: "upstream said 503" };

    const page = await renderBuilder();
    const grid = await renderPinGrid();

    expect(page).toContain('data-testid="qcms-alert"');
    expect(page).toContain("forms.error.libraryFailed");
    // TWO VOCABULARIES IN ONE ASSERTION SET, and it is not an oversight. The grid's
    // library-owned cells are resolved inside `lib/forms/pin-grid.ts`, which is redirected
    // to the REAL module here (it is the subject) and therefore imports the REAL catalog
    // by relative path - so those cells carry English, while everything a component
    // renders through the mocked `@/lib/i18n/en` carries its key.
    //
    // Both tags below say the library was asked and answered. It was not asked.
    expect(grid).not.toContain("Version not found");
    expect(grid).not.toContain('data-pin-state="missing"');
    expect(grid).not.toContain("No label in the library");
    expect(grid).toContain('data-fallback="Label not known"');
    // And the form screen the page actually opens on says nothing about the library
    // either, which is the claim the warning above it would otherwise contradict.
    expect(page).not.toContain("Version not found");
    expect(page).not.toContain('data-pin-state="missing"');
  });

  it("keeps the builder and its draft edits when the library read fails", async () => {
    libraryResult = { ok: false, message: "upstream said 503" };

    const html = await renderPinGrid();

    // The pin is still listed, as a row of the ownership grid, and its form-owned cells
    // still carry the facts the draft read supplied.
    expect(html).toContain('data-pin-question="q_one"');
    expect(html).toContain('data-pin-version="1"');
    // Every control that acts on the draft is still there: the row grip that opens the
    // reorder menu, the version menu, and the library button.
    expect(html).toContain("forms.step.rowActions");
    expect(html).toContain("forms.step.movePin");
    expect(html).toContain("forms.step.addQuestion");
  });

  it("still tags a pin the library really has lost when the read succeeds", async () => {
    // The control. A library that WAS read and does not hold `q_one` is the case the tag
    // exists for, so gating it on the read must not delete it.
    const grid = await renderPinGrid();

    expect(grid).toContain("Version not found");
    expect(grid).toContain('data-pin-state="missing"');
    expect(grid).toContain('data-fallback="No label in the library"');
    expect(await renderBuilder()).not.toContain("forms.error.libraryFailed");
  });
});

/**
 * The move-pin menu, rendered from `StepEditor` directly because its contents live inside
 * a popover a static render of the page never opens (see the file header).
 *
 * "No other published version" is a statement about the library, and a read that failed is
 * not entitled to it: with `ok ? data : []` every pin in every form reported that there
 * was nowhere else to move it.
 */
describe("the move-pin menu's account of the library (issues 572, 544)", () => {
  const STEP = FORM_DETAIL.draft.steps[0];

  async function renderStepEditor(library: unknown): Promise<string> {
    const { StepEditor } = await import("../../components/forms/step-editor");
    return renderToStaticMarkup(
      <StepEditor
        draft={FORM_DETAIL.draft}
        step={STEP as never}
        library={library as never}
        issues={[]}
        onAddPins={() => undefined}
        onMovePin={() => undefined}
        onRemovePin={() => undefined}
        onReorderPin={() => undefined}
      />,
    );
  }

  it("says the versions are unknown when the library read failed", async () => {
    const html = await renderStepEditor({ ok: false });

    expect(html).toContain("forms.step.movePinUnknown");
    expect(html).not.toContain("forms.step.movePinNone");
  });

  it("still says there is no other version when the library was read and has none", async () => {
    const html = await renderStepEditor({
      ok: true,
      data: [
        {
          questionId: "q_one",
          slug: "one",
          label: null,
          type: "shortText",
          versions: [{ version: 1, status: "published" }],
        },
      ],
    });

    expect(html).toContain("forms.step.movePinNone");
    expect(html).not.toContain("forms.step.movePinUnknown");
  });
});
