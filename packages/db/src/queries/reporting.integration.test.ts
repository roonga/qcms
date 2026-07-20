import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@qcms/a2ui-compiler";
import { FormId, QuestionId, SessionId } from "@qcms/core";
import type { AnswerValue, FormDefinition, LockedSubmission } from "@qcms/core";

import { startTestDb, type TestDb } from "../testing/harness.js";
import {
  clearSubmissionFlag,
  createForm,
  createSession,
  eraseSession,
  fetchResponsePage,
  getResponse,
  getSubmission,
  insertFormVersion,
  insertSubmission,
  listResponses,
  listTombstones,
  markSubmitted,
} from "./index.js";

/**
 * Live-DB coverage for the reporting-view read helpers (task 023) against the
 * 013 Testcontainers harness. These assert the erasure guarantee at the query
 * layer: erased sessions never appear in list/detail/export reads (the view's
 * tombstone anti-join), plus filters, keyset paging, tombstone listing, and the
 * race-safe flag release. Requires Docker.
 */

const BOOT_TIMEOUT = 120_000;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;

async function seedFormVersion(id: string, version = 1): Promise<FormId> {
  const formId = FormId.parse(id);
  await createForm(testDb.db, { formId, slug: `${id}-${String(version)}`, defaultLocale: "en" });
  for (let v = 1; v <= version; v += 1) {
    await insertFormVersion(testDb.db, {
      formId,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });
  }
  return formId;
}

function locked(
  entries: ReadonlyArray<{ questionId: string; value: AnswerValue }>,
): LockedSubmission {
  return {
    answers: entries.map((e) => ({ questionId: QuestionId.parse(e.questionId), value: e.value })),
    flowState: { visited: [], hidden: [] },
    contentHash: "0".repeat(64),
  } as unknown as LockedSubmission;
}

async function seedSubmitted(opts: {
  formId: FormId;
  version: number;
  sessionId: SessionId;
  entries: ReadonlyArray<{ questionId: string; value: AnswerValue }>;
  submittedAt: Date;
  flaggedReason?: string;
  contentHash?: string;
}): Promise<void> {
  await createSession(testDb.db, {
    sessionId: opts.sessionId,
    formId: opts.formId,
    formVersion: opts.version,
    accessMode: "anonymous",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await markSubmitted(testDb.db, opts.sessionId);
  await insertSubmission(testDb.db, {
    sessionId: opts.sessionId,
    contentHash: opts.contentHash ?? "0".repeat(64),
    lockedAnswers: locked(opts.entries),
    submittedAt: opts.submittedAt,
    ...(opts.flaggedReason !== undefined ? { flaggedReason: opts.flaggedReason } : {}),
  });
}

describe("listResponses", () => {
  it("lists submitted responses newest-first with total, and filters by version/date/flag", async () => {
    const formId = await seedFormVersion("frm_list", 2);
    await seedSubmitted({
      formId,
      version: 1,
      sessionId: SessionId.parse("ses_list_a"),
      entries: [{ questionId: "q_t", value: "a" }],
      submittedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await seedSubmitted({
      formId,
      version: 2,
      sessionId: SessionId.parse("ses_list_b"),
      entries: [{ questionId: "q_t", value: "b" }],
      submittedAt: new Date("2026-02-05T00:00:00.000Z"),
    });
    await seedSubmitted({
      formId,
      version: 2,
      sessionId: SessionId.parse("ses_list_flagged"),
      entries: [{ questionId: "q_t", value: "c" }],
      submittedAt: new Date("2026-02-10T00:00:00.000Z"),
      flaggedReason: "honeypot",
    });

    const all = await listResponses(testDb.db, { formId, limit: 50, offset: 0 });
    expect(all.total).toBe(3);
    // Newest first.
    expect(all.rows.map((r) => r.sessionId)).toEqual([
      "ses_list_flagged",
      "ses_list_b",
      "ses_list_a",
    ]);
    expect(all.rows.map((r) => r.answers)).toContainEqual({ q_t: "c" });

    // Version filter.
    const v2 = await listResponses(testDb.db, { formId, version: 2, limit: 50, offset: 0 });
    expect(v2.total).toBe(2);
    expect(v2.rows.every((r) => r.formVersion === 2)).toBe(true);

    // Date range filter (inclusive bounds).
    const window = await listResponses(testDb.db, {
      formId,
      from: new Date("2026-02-02T00:00:00.000Z"),
      to: new Date("2026-02-06T00:00:00.000Z"),
      limit: 50,
      offset: 0,
    });
    expect(window.rows.map((r) => r.sessionId)).toEqual(["ses_list_b"]);

    // Flagged filter surfaces the reason; unflagged excludes it.
    const flagged = await listResponses(testDb.db, { formId, flagged: true, limit: 50, offset: 0 });
    expect(flagged.rows.map((r) => r.sessionId)).toEqual(["ses_list_flagged"]);
    expect(flagged.rows[0]!.flaggedReason).toBe("honeypot");
    const clean = await listResponses(testDb.db, { formId, flagged: false, limit: 50, offset: 0 });
    expect(clean.rows.every((r) => r.flaggedReason === null)).toBe(true);
    expect(clean.total).toBe(2);

    // Pagination: limit + offset walks the ordered set.
    const page1 = await listResponses(testDb.db, { formId, limit: 2, offset: 0 });
    const page2 = await listResponses(testDb.db, { formId, limit: 2, offset: 2 });
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(1);
    expect(page1.total).toBe(3);
  });

  it("excludes erased sessions from the list", async () => {
    const formId = await seedFormVersion("frm_list_erase", 1);
    const kept = SessionId.parse("ses_list_kept");
    const erased = SessionId.parse("ses_list_erased");
    await seedSubmitted({
      formId,
      version: 1,
      sessionId: kept,
      entries: [{ questionId: "q_t", value: "keep" }],
      submittedAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    await seedSubmitted({
      formId,
      version: 1,
      sessionId: erased,
      entries: [{ questionId: "q_t", value: "secret" }],
      submittedAt: new Date("2026-03-02T00:00:00.000Z"),
    });
    await eraseSession(testDb.db, erased, "subject_request");

    const res = await listResponses(testDb.db, { formId, limit: 50, offset: 0 });
    expect(res.total).toBe(1);
    expect(res.rows.map((r) => r.sessionId)).toEqual([kept]);
  });
});

describe("getResponse", () => {
  it("returns detail with content hash and flag; returns undefined for erased/missing", async () => {
    const formId = await seedFormVersion("frm_detail", 1);
    const sessionId = SessionId.parse("ses_detail");
    await seedSubmitted({
      formId,
      version: 1,
      sessionId,
      entries: [
        { questionId: "q_name", value: "Ada" },
        { questionId: "q_multi", value: ["opt_a", "opt_b"] as unknown as AnswerValue },
      ],
      submittedAt: new Date("2026-04-01T00:00:00.000Z"),
      contentHash: "a".repeat(64),
      flaggedReason: "too_fast",
    });

    const detail = await getResponse(testDb.db, formId, sessionId);
    expect(detail).toBeDefined();
    expect(detail!.contentHash).toBe("a".repeat(64));
    expect(detail!.flaggedReason).toBe("too_fast");
    expect(detail!.answers).toEqual({ q_name: "Ada", q_multi: ["opt_a", "opt_b"] });

    // Missing session → undefined.
    expect(await getResponse(testDb.db, formId, SessionId.parse("ses_nope"))).toBeUndefined();

    // Erased → undefined (view exclusion; detail cannot bypass it).
    await eraseSession(testDb.db, sessionId, "subject_request");
    expect(await getResponse(testDb.db, formId, sessionId)).toBeUndefined();
  });
});

describe("fetchResponsePage (export keyset)", () => {
  it("walks every response in session_id order across bounded pages, excluding erased", async () => {
    const formId = await seedFormVersion("frm_export", 1);
    const ids = ["ses_exp_01", "ses_exp_02", "ses_exp_03", "ses_exp_04", "ses_exp_05"];
    for (const [i, id] of ids.entries()) {
      await seedSubmitted({
        formId,
        version: 1,
        sessionId: SessionId.parse(id),
        entries: [{ questionId: "q_t", value: `v${String(i)}` }],
        submittedAt: new Date(`2026-05-0${String(i + 1)}T00:00:00.000Z`),
      });
    }
    await eraseSession(testDb.db, SessionId.parse("ses_exp_03"), "subject_request");

    const collected: string[] = [];
    let after: SessionId | undefined;
    for (;;) {
      const page = await fetchResponsePage(testDb.db, {
        formId,
        limit: 2,
        ...(after !== undefined ? { afterSessionId: after } : {}),
      });
      if (page.length === 0) break;
      for (const row of page) collected.push(row.sessionId);
      after = SessionId.parse(page[page.length - 1]!.sessionId);
      if (page.length < 2) break;
    }
    // Ascending session_id order, erased session absent.
    expect(collected).toEqual(["ses_exp_01", "ses_exp_02", "ses_exp_04", "ses_exp_05"]);
  });
});

describe("listTombstones", () => {
  it("lists tombstones newest-first, scoped by form", async () => {
    const formId = await seedFormVersion("frm_tomb", 1);
    const other = await seedFormVersion("frm_tomb_other", 1);
    const a = SessionId.parse("ses_tomb_a");
    const b = SessionId.parse("ses_tomb_b");
    const c = SessionId.parse("ses_tomb_c");
    await seedSubmitted({
      formId,
      version: 1,
      sessionId: a,
      entries: [{ questionId: "q_t", value: "1" }],
      submittedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    await seedSubmitted({
      formId,
      version: 1,
      sessionId: b,
      entries: [{ questionId: "q_t", value: "2" }],
      submittedAt: new Date("2026-06-02T00:00:00.000Z"),
    });
    await seedSubmitted({
      formId: other,
      version: 1,
      sessionId: c,
      entries: [{ questionId: "q_t", value: "3" }],
      submittedAt: new Date("2026-06-03T00:00:00.000Z"),
    });
    await eraseSession(testDb.db, a, "subject_request");
    await eraseSession(testDb.db, b, "policy");
    await eraseSession(testDb.db, c, "subject_request");

    const scoped = await listTombstones(testDb.db, { formId });
    expect(scoped.map((t) => t.sessionId).sort()).toEqual([a, b].sort());
    expect(scoped.every((t) => t.formId === formId)).toBe(true);
    const withReason = scoped.find((t) => t.sessionId === b);
    expect(withReason?.reason).toBe("policy");
  });
});

describe("clearSubmissionFlag", () => {
  it("releases a flagged submission once (idempotent transition)", async () => {
    const formId = await seedFormVersion("frm_unflag", 1);
    const sessionId = SessionId.parse("ses_unflag");
    await seedSubmitted({
      formId,
      version: 1,
      sessionId,
      entries: [{ questionId: "q_t", value: "x" }],
      submittedAt: new Date("2026-07-01T00:00:00.000Z"),
      flaggedReason: "honeypot",
    });

    // First clear transitions the row and reports true.
    expect(await clearSubmissionFlag(testDb.db, sessionId)).toBe(true);
    expect((await getSubmission(testDb.db, sessionId))?.flaggedReason).toBeNull();

    // Second clear is a no-op → false (no duplicate release).
    expect(await clearSubmissionFlag(testDb.db, sessionId)).toBe(false);

    // A never-flagged submission also reports false.
    const clean = SessionId.parse("ses_unflag_clean");
    await seedSubmitted({
      formId,
      version: 1,
      sessionId: clean,
      entries: [{ questionId: "q_t", value: "y" }],
      submittedAt: new Date("2026-07-02T00:00:00.000Z"),
    });
    expect(await clearSubmissionFlag(testDb.db, clean)).toBe(false);
  });
});
