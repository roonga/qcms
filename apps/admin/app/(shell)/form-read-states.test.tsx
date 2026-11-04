import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  draftAgentAssisted: false,
  draftUpdatedAt: null,
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

let formDetailResult: unknown = { ok: true, data: FORM_DETAIL };
let webhooksResult: unknown = { ok: true, data: [] };
let deliveriesResult: unknown = { ok: true, data: [] };
let linksResult: unknown = { ok: true, data: [] };
let libraryResult: unknown = { ok: true, data: [] };

vi.mock("@/lib/announce", () => ({ announce: () => undefined }));
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
vi.mock("@/components/forms/public-form-link", () => ({
  PublicFormLink: () => <div data-testid="qcms-public-link-stub" />,
}));
vi.mock("@/lib/forms/screen-name", () => ({
  currentScreenName: () => "Form details",
}));
vi.mock("@/lib/server/config", () => ({ portalBaseUrl: () => undefined }));
vi.mock("@/lib/ops/unexpected", () => ({ unexpected: () => "ops.error.unexpected" }));

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
vi.mock("@/lib/server/environments", () => ({
  resolvedEnvironment: () =>
    Promise.resolve({
      status: "known",
      environment: "prod",
      environments: ["prod"],
      selection: "",
    }),
}));
vi.mock("@/lib/server/webhook-ops", () => ({
  listWebhooks: () => Promise.resolve(webhooksResult),
  listDeliveries: () => Promise.resolve(deliveriesResult),
  listEndpointProposals: () => Promise.resolve({ ok: true, data: [] }),
}));
vi.mock("@/lib/server/links", () => ({
  listLinks: () => Promise.resolve(linksResult),
  MAX_LINK_BATCH: 100,
}));

const NOOP_ACTION = () => Promise.resolve({ status: "idle" });

vi.mock("./webhooks/actions", () => ({
  confirmEndpointChangeAction: NOOP_ACTION,
  createWebhookAction: NOOP_ACTION,
  deactivateWebhookAction: NOOP_ACTION,
  reactivateWebhookAction: NOOP_ACTION,
  retargetWebhookAction: NOOP_ACTION,
  rotateSecretAction: NOOP_ACTION,
  withdrawEndpointChangeAction: NOOP_ACTION,
}));
vi.mock("./forms/actions", () => ({
  mintLinksAction: NOOP_ACTION,
  revokeLinkAction: NOOP_ACTION,
  previewConditionAction: NOOP_ACTION,
  saveDraftAction: NOOP_ACTION,
  setFormStatusAction: NOOP_ACTION,
  updateSettingsAction: NOOP_ACTION,
  validateDraftAction: NOOP_ACTION,
}));

vi.mock("@/lib/i18n/en", () => ({
  t: (key: string) => key,
  tPlural: (one: string) => one,
}));

/* The real Dialog portals; static rendering a tree containing it produces empty markup. */
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
  Menu: ({
    triggerLabel,
    trigger,
    header,
    items = [],
  }: {
    triggerLabel?: string;
    trigger?: ReactNode;
    header?: ReactNode;
    items?: readonly { id: string; label?: ReactNode; kind?: string }[];
  }) => (
    <div data-testid="qcms-menu-stub">
      <button type="button" aria-label={triggerLabel}>
        {trigger ?? triggerLabel}
      </button>
      {header}
      <ul>
        {items.map((item) =>
          item.kind === "separator" ? <hr key={item.id} /> : <li key={item.id}>{item.label}</li>,
        )}
      </ul>
    </div>
  ),
  NumberField: () => <input aria-label="stub" type="number" />,
  Select: () => <select aria-label="stub" />,
  Table: () => <div data-testid="qcms-kit-table-stub" />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  TextField: () => <input aria-label="stub" />,
}));

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

describe("the per-form webhook config's read states (issues 572, 544)", () => {
  it("makes no claim about endpoints when the list read fails", async () => {
    webhooksResult = { ok: false, message: "upstream said 503" };

    const html = await renderFormWebhooks();

    expect(html).toContain('data-testid="qcms-alert"');
    expect(html).toContain("ops.webhooks.listFailed");
    expect(html).not.toContain("ops.webhooks.empty");
    expect(html).not.toContain('data-testid="qcms-webhooks-empty"');
    expect(html).not.toContain('data-testid="qcms-webhooks-table"');
  });

  it("keeps the heading and the creating action when the list read fails", async () => {
    webhooksResult = { ok: false, message: "upstream said 503" };

    const html = await renderFormWebhooks();

    expect(html).toContain('id="qcms-webhooks-heading"');
    expect(html.match(/ops\.webhooks\.add/g)).toHaveLength(1);
  });

  it("still renders the empty panel when the form genuinely has no endpoint", async () => {
    const html = await renderFormWebhooks();

    expect(html).toMatch(EMPTY_PANEL);
    expect(html).toMatch(EMPTY_HEADING);
    expect(html).toContain('data-testid="qcms-webhooks-empty"');
    expect(html).toContain("ops.webhooks.emptyTitle");
    expect(html.match(/ops\.webhooks\.add/g)).toHaveLength(1);
  });

  it("renders one family table, wrapped, when the form has an endpoint", async () => {
    webhooksResult = { ok: true, data: [WEBHOOK] };

    const html = await renderFormWebhooks();

    expect(html).toContain('<div class="qcms-table"><table');
    expect(html).toContain('data-testid="qcms-webhooks-table"');
    expect(html).not.toContain('data-testid="qcms-webhooks-empty"');
  });
});

describe("the delivery dashboard's read states (issues 572, 544)", () => {
  it("makes no claim about deliveries when the read fails", async () => {
    deliveriesResult = { ok: false, message: "upstream said 503" };

    const html = await renderFormWebhooks();

    expect(html).toContain("ops.deliveries.loadFailed");
    expect(html).not.toContain("ops.deliveries.emptyTitle");
    expect(html).not.toContain('data-testid="qcms-deliveries-empty"');
    expect(html).not.toContain('data-testid="qcms-deliveries-table"');
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

describe("the secure-link list's read states (issues 572, 544)", () => {
  it("makes no claim about links when the list read fails", async () => {
    linksResult = { ok: false, message: "upstream said 503" };

    const html = await renderLinks();

    expect(html).toContain('data-testid="qcms-alert"');
    expect(html).toContain("forms.links.listFailed");
    expect(html).not.toContain("forms.links.empty");
    expect(html).not.toContain('data-testid="qcms-links-empty"');
    expect(html).not.toContain('data-testid="qcms-links-table"');
  });

  it("keeps the heading and the mint control when the list read fails", async () => {
    linksResult = { ok: false, message: "upstream said 503" };

    const html = await renderLinks();

    expect(html).toContain('id="qcms-links-heading"');
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

describe("the form builder's library read states (issues 572, 544)", { timeout: 30_000 }, () => {
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
        onAddGroup={() => undefined}
        onOpenGroup={() => undefined}
        onMoveGroup={() => undefined}
        onRemoveGroup={() => undefined}
      />,
    );
  }

  it("makes no claim about the pinned versions when the library read fails", async () => {
    libraryResult = { ok: false, message: "upstream said 503" };

    const page = await renderBuilder();
    const grid = await renderPinGrid();

    expect(page).toContain('data-testid="qcms-alert"');
    expect(page).toContain("forms.error.libraryFailed");
    expect(grid).not.toContain("forms.step.pinMissing");
    expect(grid).not.toContain('data-pin-state="missing"');
    expect(grid).not.toContain("forms.step.labelMissing");
    expect(grid).toContain('data-fallback="forms.step.labelUnknown"');
    expect(page).not.toContain("forms.step.pinMissing");
    expect(page).not.toContain('data-pin-state="missing"');
  });

  it("keeps the builder and its draft edits when the library read fails", async () => {
    libraryResult = { ok: false, message: "upstream said 503" };

    const html = await renderPinGrid();

    expect(html).toContain('data-pin-question="q_one"');
    expect(html).toContain('data-pin-version="1"');
    expect(html).toContain("forms.step.rowActions");
    expect(html).toContain("forms.step.movePin");
    expect(html).toContain("forms.step.addQuestion");
  });

  it("still tags a pin the library really has lost when the read succeeds", async () => {
    const grid = await renderPinGrid();

    expect(grid).toContain("forms.step.pinMissing");
    expect(grid).toContain('data-pin-state="missing"');
    expect(grid).toContain('data-fallback="forms.step.labelMissing"');
    expect(await renderBuilder()).not.toContain("forms.error.libraryFailed");
  });
});

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
        onAddGroup={() => undefined}
        onOpenGroup={() => undefined}
        onMoveGroup={() => undefined}
        onRemoveGroup={() => undefined}
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
