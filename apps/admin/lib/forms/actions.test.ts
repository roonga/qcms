import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../i18n/en.ts";

import { blankDraft } from "./draft.ts";
import type { DraftForm } from "./types.ts";

/**
 * The form builder's server actions, at their two refusal seams (task 033, PR #245 review).
 *
 * ## Why the module is reachable from here at all
 *
 * `app/(shell)/forms/actions.ts` is a `"use server"` module and cannot export the helpers
 * it guards with (Next allows only async exports there), so the guards are exercised
 * through the actions themselves. Its imports are written with the app's `@/` alias, which
 * only Next's bundler resolves - Vitest does not - so each one is declared below. The
 * three that are pure app logic (`draft`, `errors`, `builder-state`) are **pass-through**:
 * the factory re-exports the real module, so what runs here is the shipped code and not a
 * stand-in. Only the genuinely external edges are faked: Next's cache/navigation and the
 * two `lib/server` modules that reach a session store and the API over the network.
 *
 * The test file lives under `lib/` rather than beside its subject because `app/` is
 * route-scanned by Next; no test file in either app sits inside it.
 */

/** Mirrors the cap in `actions.ts`, which a `"use server"` module cannot export. */
const MAX_DEFINITION_BYTES = 64 * 1024;

const calls = vi.hoisted(() => ({
  saveDraft: 0,
  previewCondition: 0,
  previewDraft: 0,
  publishForm: 0,
  mintLinks: 0,
}));

/** What the mocked API layer answers with next. Set per test, reset between them. */
const answers = vi.hoisted(() => ({
  publish: undefined as unknown,
  preview: undefined as unknown,
  mint: undefined as unknown,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
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
  publishForm: () => {
    calls.publishForm += 1;
    return Promise.resolve(answers.publish ?? { ok: true, data: { version: 1, publishedAt: "" } });
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
vi.mock("@/lib/server/links", () => ({
  MAX_LINK_BATCH: 100,
  mintLinks: () => {
    calls.mintLinks += 1;
    return Promise.resolve(answers.mint ?? { ok: true, data: [] });
  },
  listLinks: () => Promise.resolve({ ok: true, data: [] }),
  revokeLink: () => Promise.resolve({ ok: true, data: { linkId: "lnk_1", revokedAt: "" } }),
}));
vi.mock("@/lib/forms/draft", async () => await import("./draft.ts"));
vi.mock("@/lib/forms/errors", async () => await import("./errors.ts"));
vi.mock("@/lib/forms/builder-state", async () => await import("./builder-state.ts"));
vi.mock("@/lib/i18n/en", async () => await import("../i18n/en.ts"));

const {
  createFormAction,
  mintLinksAction,
  previewConditionAction,
  previewDraftAction,
  publishFormAction,
  saveDraftAction,
} = await import("../../app/(shell)/forms/actions.ts");

/**
 * A draft whose serialization is exactly `bytes` bytes of UTF-8.
 *
 * The filler is CJK, which is the whole point: each glyph is one UTF-16 code unit and
 * three UTF-8 bytes, so a document built this way is roughly a third of its true size when
 * measured with `String.prototype.length`. ASCII padding closes the last one or two bytes
 * so the target lands on the nose rather than near it.
 */
function draftOfByteSize(bytes: number): DraftForm {
  const base = blankDraft("frm_cap", "en");
  const overhead = Buffer.byteLength(JSON.stringify({ ...base, title: { en: "" } }), "utf8");
  const room = bytes - overhead;
  const glyphs = Math.floor(room / 3);
  return { ...base, title: { en: "字".repeat(glyphs) + "a".repeat(room - glyphs * 3) } };
}

/** The serialized size of a document in the unit the cap names. */
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
    // The regression this pins: counted in code units the same document scores about a
    // third of its size, so the pre-fix cap waved it through.
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
    });

    expect(state.status).toBe("error");
    expect(calls.previewCondition).toBe(before);
  });
});

describe("createFormAction names the field that is actually wrong", () => {
  /** The create form's post, as `useActionState` assembles it. */
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
    // The slug was fine, so it comes back for redisplay rather than being blamed.
    expect(state.submitted?.slug).toBe("demo-form");
  });
});

describe("034's actions keep a refusal distinct from an error", () => {
  beforeEach(() => {
    answers.publish = undefined;
    answers.preview = undefined;
    answers.mint = undefined;
  });

  /** A 422 as the proxy normalises it: a code, a sentence, and the kernel's issues. */
  function rejection(code: string) {
    return {
      ok: false,
      code,
      message: "refused",
      issues: [{ code: "RULE_BACKWARD_TARGET", message: "backwards", path: { rule: "rul_a" } }],
    };
  }

  it("reports a refused publish as `rejected`, carrying every issue", async () => {
    answers.publish = rejection("PUBLISH_REJECTED");
    const state = await publishFormAction("frm_demo_form");

    // `rejected` rather than `error`, because the screen owes the author a work list
    // here and a sentence there.
    expect(state.status).toBe("rejected");
    expect(state.issues).toHaveLength(1);
    expect(state.version).toBeUndefined();
  });

  it("reports a publish failure with no issues as an ordinary error", async () => {
    answers.publish = { ok: false, code: "internal", message: "boom", issues: [] };
    const state = await publishFormAction("frm_demo_form");

    expect(state.status).toBe("error");
    expect(state.issues).toBeUndefined();
  });

  it("reports a draft that will not compile as `rejected`, with its issues", async () => {
    answers.preview = rejection("PREVIEW_REJECTED");
    const state = await previewDraftAction("frm_demo_form", {
      draft: blankDraft("frm_demo_form", "en"),
      answers: {},
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
    });

    expect(state.status).toBe("error");
    expect(calls.previewDraft).toBe(before);
  });

  it("bounds the mint batch before the request leaves the BFF", async () => {
    const before = calls.mintLinks;
    const tooMany = await mintLinksAction("frm_demo_form", {
      expiresAt: "2030-01-01T00:00:00.000Z",
      oneTime: false,
      count: 1000,
    });
    const tooFew = await mintLinksAction("frm_demo_form", {
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
    const state = await mintLinksAction("frm_demo_form", {
      expiresAt: "  ",
      oneTime: true,
      count: 1,
    });

    expect(state).toMatchObject({ status: "error" });
    expect(state.message).toBe(t("forms.error.linkExpiryInvalid"));
    expect(calls.mintLinks).toBe(before);
  });

  it("never echoes an answer value in a preview failure message (SEC-13)", async () => {
    answers.preview = { ok: false, code: "internal", message: "boom", issues: [] };
    const state = await previewDraftAction("frm_demo_form", {
      draft: blankDraft("frm_demo_form", "en"),
      answers: { q_a: "answer-value-that-must-not-come-back" },
    });

    expect(state.message).not.toContain("answer-value-that-must-not-come-back");
  });
});
