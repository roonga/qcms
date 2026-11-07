import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../i18n/en.ts";

import { blankDraft } from "./draft.ts";
import type { DraftForm } from "./types.ts";

// Use the real actions to reach guards: use-server modules may export only async actions.
// Stub I/O dependencies while keeping the action and guard decisions intact.

const MAX_DEFINITION_BYTES = 64 * 1024;

const calls = vi.hoisted(() => ({
  saveDraft: 0,
  previewCondition: 0,
  previewDraft: 0,
  publishBatch: 0,
  mintLinks: 0,
}));

const answers = vi.hoisted(
  (): { publish?: unknown; preview?: unknown; mint?: unknown; lookup?: unknown } => ({}),
);

const sent = vi.hoisted((): { mintExpiresAt: string | undefined } => ({
  mintExpiresAt: undefined,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/server/workspace-context", () => ({
  currentWorkspaceId: () => Promise.resolve("org_default_workspace"),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
}));
vi.mock("@/lib/server/session", () => ({
  requireAdminSession: () =>
    Promise.resolve({
      userId: "usr_1",
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      twoFactorEnabled: true,
      token: "session-token-for-this-test-only",
    }),
}));
vi.mock("@/lib/server/forms", () => ({
  createForm: () => Promise.resolve({ ok: true, data: { formId: "frm_demo_form" } }),
  saveDraft: () => {
    calls.saveDraft += 1;
    return Promise.resolve({ ok: true, data: { issues: [] } });
  },
  validateDraft: () => Promise.resolve({ ok: true, data: { valid: true, issues: [] } }),
  updateSettings: () => Promise.resolve({ ok: true, data: {} }),
  previewCondition: () => {
    calls.previewCondition += 1;
    return Promise.resolve({ ok: true, data: { outcome: "match", references: [] } });
  },
  previewDraft: () => {
    calls.previewDraft += 1;
    return Promise.resolve(
      answers.preview ?? {
        ok: true,
        data: {
          documents: [],
          compilerVersion: "0.1.0",
          a2uiSpecVersion: "0.1.0",
          flow: { visibleSteps: [], visibleQuestions: [], complete: false },
        },
      },
    );
  },
  setFormStatus: () => Promise.resolve({ ok: true, data: { status: "closed" } }),
}));

vi.mock("@/lib/server/releases", () => ({
  publishBatch: () => {
    calls.publishBatch += 1;
    return Promise.resolve(
      answers.publish ?? { ok: true, data: { version: 1, releases: [], froze: true } },
    );
  },
  releaseBatch: () =>
    Promise.resolve({ ok: true, data: { version: 1, releases: [], froze: false } }),
  lookupReleaseBatch: () => Promise.resolve(answers.lookup ?? { ok: false, code: "http_404" }),
  releaseVersion: () =>
    Promise.resolve({ ok: true, data: { version: 1, environment: "prod", rollback: false } }),
  reviewRelease: () => Promise.resolve({ ok: true, data: { targets: [] } }),
}));

vi.mock("@/lib/server/environments", () => ({
  confirmShownEnvironment: (_session: unknown, shown: string | undefined) =>
    Promise.resolve({ ok: true, environment: shown ?? "prod" }),
}));
vi.mock("@/lib/server/links", () => ({
  MAX_LINK_BATCH: 100,
  mintLinks: (_session: unknown, _formId: string, request: { expiresAt: string }) => {
    calls.mintLinks += 1;
    sent.mintExpiresAt = request.expiresAt;
    return Promise.resolve(answers.mint ?? { ok: true, data: [] });
  },
  listLinks: () => Promise.resolve({ ok: true, data: [] }),
  revokeLink: () => Promise.resolve({ ok: true, data: { linkId: "lnk_1", revokedAt: "" } }),
}));

const {
  createFormAction,
  mintLinksAction,
  previewConditionAction,
  previewDraftAction,
  confirmPublishAction,
  lookupPublishResultAction,
  saveDraftAction,
} = await import("../../app/(shell)/forms/actions.ts");

function draftOfByteSize(bytes: number): DraftForm {
  const base = blankDraft("frm_cap", "en");
  const overhead = Buffer.byteLength(JSON.stringify({ ...base, title: { en: "" } }), "utf8");
  const room = bytes - overhead;
  const glyphs = Math.floor(room / 3);
  return { ...base, title: { en: "字".repeat(glyphs) + "a".repeat(room - glyphs * 3) } };
}

function byteSize(document: unknown): number {
  return Buffer.byteLength(JSON.stringify(document), "utf8");
}

describe("the definition cap counts UTF-8 bytes, not UTF-16 code units", () => {
  it("forwards a multi-byte draft that sits exactly on the cap", async () => {
    const draft = draftOfByteSize(MAX_DEFINITION_BYTES);
    expect(byteSize(draft)).toBe(MAX_DEFINITION_BYTES);

    const before = calls.saveDraft;
    const state = await saveDraftAction("frm_cap", draft);

    expect(state.status).toBe("saved");
    expect(calls.saveDraft).toBe(before + 1);
  });

  it("refuses a multi-byte draft one byte over the cap, and does not forward it", async () => {
    const draft = draftOfByteSize(MAX_DEFINITION_BYTES + 1);
    expect(byteSize(draft)).toBe(MAX_DEFINITION_BYTES + 1);

    expect(JSON.stringify(draft).length).toBeLessThan(MAX_DEFINITION_BYTES / 2);

    const before = calls.saveDraft;
    const state = await saveDraftAction("frm_cap", draft);

    expect(state).toMatchObject({ status: "error", code: "INVALID_FORM_DEFINITION" });
    expect(state.message).toBe(t("forms.error.invalidDefinition"));
    expect(calls.saveDraft).toBe(before);
  });

  it("still refuses a document it cannot serialize rather than throwing", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["itself"] = cyclic;

    const before = calls.previewCondition;
    const state = await previewConditionAction("frm_cap", {
      draft: blankDraft("frm_cap", "en"),
      ruleId: "rul_a",
      answers: { q_a: cyclic },
      instances: {},
    });

    expect(state.status).toBe("error");
    expect(calls.previewCondition).toBe(before);
  });
});

describe("createFormAction names the field that is actually wrong", () => {
  function submission(slug: string, defaultLocale: string): FormData {
    const data = new FormData();
    data.set("slug", slug);
    data.set("title", "Demo");
    data.set("defaultLocale", defaultLocale);
    return data;
  }

  it("reports an unusable slug as an invalid form id", async () => {
    const state = await createFormAction({ status: "idle" }, submission("!!!", "en"));

    expect(state).toMatchObject({ status: "error", code: "INVALID_FORM_ID" });
    expect(state.message).toBe(t("forms.error.invalidId"));
    expect(state.submitted?.slug).toBe("!!!");
  });

  it("reports a blank default locale as an invalid locale, not as an invalid id", async () => {
    const state = await createFormAction({ status: "idle" }, submission("demo-form", "   "));

    expect(state).toMatchObject({ status: "error", code: "INVALID_DEFAULT_LOCALE" });
    expect(state.message).toBe(t("forms.error.invalidLocale"));
    expect(state.message).not.toBe(t("forms.error.invalidId"));

    expect(state.submitted?.slug).toBe("demo-form");
  });
});

describe("034's actions keep a refusal distinct from an error", () => {
  beforeEach(() => {
    answers.publish = undefined;
    answers.preview = undefined;
    answers.mint = undefined;
    answers.lookup = undefined;
    sent.mintExpiresAt = undefined;
  });

  function rejection(code: string) {
    return {
      ok: false,
      code,
      message: "refused",
      issues: [{ code: "RULE_BACKWARD_TARGET", message: "backwards", path: { rule: "rul_a" } }],
    };
  }

  const CONFIRM = {
    idempotencyKey: "00000000-0000-4000-8000-000000000000",
    expectedWorkflowRevision: null,
    source: { kind: "draft", draftRevision: 3 },
    targets: [],
  } as const;

  it("reports a refused publish as `rejected`, carrying every issue", async () => {
    answers.publish = rejection("PUBLISH_REJECTED");
    const state = await confirmPublishAction("frm_demo_form", CONFIRM);

    expect(state.status).toBe("rejected");
    expect(state.issues).toHaveLength(1);
    expect(state.version).toBeUndefined();
  });

  it("reports a publish failure with no issues as an ordinary error", async () => {
    answers.publish = { ok: false, code: "internal", message: "boom", issues: [] };
    const state = await confirmPublishAction("frm_demo_form", CONFIRM);

    expect(state.status).toBe("error");
    expect(state.issues).toBeUndefined();
  });

  it("keeps a stale review apart, because its recovery is a re-read", async () => {
    answers.publish = { ok: false, code: "STALE_REVIEW", message: "moved", issues: [] };
    const state = await confirmPublishAction("frm_demo_form", CONFIRM);

    expect(state.status).toBe("stale");
  });

  it("reports a key with no stored result as `not-committed`, never as a committed one", async () => {
    const state = await lookupPublishResultAction(
      "frm_demo_form",
      "00000000-0000-4000-8000-000000000000",
    );

    expect(state.status).toBe("not-committed");
    expect(state.version).toBeUndefined();
  });

  it("recovers the recorded shape, so a publish-only result does not read as released", async () => {
    answers.lookup = { ok: true, data: { version: 1, releases: [], froze: true } };
    const state = await lookupPublishResultAction(
      "frm_demo_form",
      "00000000-0000-4000-8000-000000000000",
    );

    expect(state.status).toBe("done");
    expect(state.froze).toBe(true);
    expect(state.releases).toHaveLength(0);
  });

  it("reports a draft that will not compile as `rejected`, with its issues", async () => {
    answers.preview = rejection("PREVIEW_REJECTED");
    const state = await previewDraftAction("frm_demo_form", {
      draft: blankDraft("frm_demo_form", "en"),
      answers: {},
      instances: {},
    });

    expect(state.status).toBe("rejected");
    expect(state.issues).toHaveLength(1);
  });

  it("refuses to forward an unserializable preview payload, and does not call the API", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["itself"] = cyclic;

    const before = calls.previewDraft;
    const state = await previewDraftAction("frm_demo_form", {
      draft: blankDraft("frm_demo_form", "en"),
      answers: { q_a: cyclic },
      instances: {},
    });

    expect(state.status).toBe("error");
    expect(calls.previewDraft).toBe(before);
  });

  it("bounds the mint batch before the request leaves the BFF", async () => {
    const before = calls.mintLinks;
    const tooMany = await mintLinksAction("frm_demo_form", "prod", {
      expiresAt: "2030-01-01T00:00:00.000Z",
      oneTime: false,
      count: 1000,
    });
    const tooFew = await mintLinksAction("frm_demo_form", "prod", {
      expiresAt: "2030-01-01T00:00:00.000Z",
      oneTime: false,
      count: 0,
    });

    expect(tooMany.status).toBe("error");
    expect(tooFew.status).toBe("error");
    expect(calls.mintLinks).toBe(before);
  });

  it("refuses a mint with no expiry rather than sending one the route will reject", async () => {
    const before = calls.mintLinks;
    const state = await mintLinksAction("frm_demo_form", "prod", {
      expiresAt: "  ",
      oneTime: true,
      count: 1,
    });

    expect(state).toMatchObject({ status: "error" });
    expect(state.message).toBe(t("forms.error.linkExpiryInvalid"));
    expect(calls.mintLinks).toBe(before);
  });

  it("sends a full instant unchanged, so a card's digest is taken over the body it posts", async () => {
    const state = await mintLinksAction("frm_demo_form", "prod", {
      expiresAt: "2030-01-01T09:30:00.000Z",
      oneTime: false,
      count: 1,
    });

    expect(state.status).toBe("minted");
    expect(sent.mintExpiresAt).toBe("2030-01-01T09:30:00.000Z");
  });

  it("still widens the mint dialog's calendar day to the end of that day in UTC", async () => {
    const state = await mintLinksAction("frm_demo_form", "prod", {
      expiresAt: "2030-01-01",
      oneTime: false,
      count: 1,
    });

    expect(state.status).toBe("minted");
    expect(sent.mintExpiresAt).toBe("2030-01-01T23:59:59.999Z");
  });

  it("never echoes an answer value in a preview failure message (SEC-13)", async () => {
    answers.preview = { ok: false, code: "internal", message: "boom", issues: [] };
    const state = await previewDraftAction("frm_demo_form", {
      draft: blankDraft("frm_demo_form", "en"),
      answers: { q_a: "answer-value-that-must-not-come-back" },
      instances: {},
    });

    expect(state.message).not.toContain("answer-value-that-must-not-come-back");
  });
});
