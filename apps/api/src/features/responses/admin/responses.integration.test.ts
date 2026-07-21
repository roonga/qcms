/**
 * Response listing / export / erasure slice tests (task 023), driven through
 * `app.request()` against the **real** kernel and the 013 Testcontainers harness
 * DB - never a mock of our own packages (CONTRIBUTING). Requires Docker.
 *
 * Covers every exit criterion:
 *  1. list / detail / filter over seeded fixtures, with erased sessions absent;
 *  2. CSV - a byte-for-byte golden export for the insurance fixture (BOM,
 *     RFC 4180 quoting, multiChoice `a;b;c`, document-order columns); JSON
 *     round-trips canonical values;
 *  3. streaming - a 10k-response CSV export completes without buffering the whole
 *     table (delivered in bounded chunks, no chunk near the document size);
 *  4. erase → list/detail/export exclude the session, the tombstone is listed,
 *     and unflag releases the withheld `response.submitted` outbox event.
 */

import {
  type FormDefinition,
  FormId,
  parseFormDefinition,
  QuestionId,
  SessionId,
} from "@qcms/core";
import type { AnswerValue, LockedSubmission } from "@qcms/core";
import type { CompiledForm } from "@qcms/a2ui-compiler";
import {
  createForm,
  createSession,
  insertFormVersion,
  insertSubmission,
  markSubmitted,
} from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { FLAG_REASONS, FlagReason } from "../flag-reasons.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, validEnv } from "../../../test-support.js";
import { registerAdminResponses } from "./route.js";

const BOOT_TIMEOUT = 120_000;
const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, {
    groups: { admin: [registerAdminAuth, registerAdminResponses] },
  });
  internalToken = internalTokenFor(deps.config);
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

// --- request helpers --------------------------------------------------------

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: "editor-1",
    ...extra,
  };
}
async function get(path: string): Promise<Response> {
  return app.request(`/admin${path}`, { headers: authHeaders() });
}
async function post(path: string, body?: unknown): Promise<Response> {
  return app.request(`/admin${path}`, {
    method: "POST",
    headers: authHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// --- fixtures ---------------------------------------------------------------

const emptyCompiled = {} as unknown as CompiledForm;

/** A form definition pinning `(step → questionIds)` at v1 (kernel-parsed). */
function formDefinition(formId: string, steps: [string, string[]][]): FormDefinition {
  const raw = {
    formId,
    defaultLocale: "en",
    title: { en: "A form" },
    steps: steps.map(([stepId, ids]) => ({
      stepId,
      title: { en: stepId },
      items: ids.map((questionId) => ({ questionId, version: 1 })),
    })),
    rules: [],
  };
  const parsed = parseFormDefinition(raw);
  if (!parsed.ok) throw new Error(`fixture form ${formId} did not parse`);
  return parsed.value;
}

/** Create a form and publish version 1 with the given step→questionIds layout. */
async function seedForm(formId: string, steps: [string, string[]][]): Promise<FormId> {
  const id = FormId.parse(formId);
  await createForm(testDb.db, { formId: id, slug: formId.replace(/_/g, "-"), defaultLocale: "en" });
  await insertFormVersion(testDb.db, {
    formId: id,
    definition: formDefinition(formId, steps),
    compiled: emptyCompiled,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  });
  return id;
}

function lockedSubmission(
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
  sessionId: string;
  entries: ReadonlyArray<{ questionId: string; value: AnswerValue }>;
  submittedAt: Date;
  contentHash?: string;
  flaggedReason?: string;
}): Promise<SessionId> {
  const sessionId = SessionId.parse(opts.sessionId);
  await createSession(testDb.db, {
    sessionId,
    formId: opts.formId,
    formVersion: 1,
    accessMode: "anonymous",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await markSubmitted(testDb.db, sessionId);
  await insertSubmission(testDb.db, {
    sessionId,
    contentHash: opts.contentHash ?? "0".repeat(64),
    lockedAnswers: lockedSubmission(opts.entries),
    submittedAt: opts.submittedAt,
    ...(opts.flaggedReason !== undefined ? { flaggedReason: opts.flaggedReason } : {}),
  });
  return sessionId;
}

interface ListBody {
  responses: Array<{
    sessionId: string;
    formVersion: number;
    flaggedReason: string | null;
    answers: Record<string, unknown>;
  }>;
  page: number;
  pageSize: number;
  total: number;
}

// --- exit criterion 1: list / detail / filter, erased absent ----------------

describe("list, detail, and filters (exit criterion 1)", () => {
  it("lists submitted responses, filters, and exposes flagged reason", async () => {
    const formId = await seedForm("frm_list_api", [
      ["stp_a", ["q_name"]],
      ["stp_b", ["q_pick"]],
    ]);
    await seedSubmitted({
      formId,
      sessionId: "ses_api_clean",
      entries: [{ questionId: "q_name", value: "Ada" }],
      submittedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await seedSubmitted({
      formId,
      sessionId: "ses_api_flagged",
      entries: [{ questionId: "q_name", value: "Bad Actor" }],
      submittedAt: new Date("2026-02-10T00:00:00.000Z"),
      flaggedReason: FlagReason.HONEYPOT,
    });

    const all = (await (await get("/forms/frm_list_api/responses")).json()) as ListBody;
    expect(all.total).toBe(2);
    expect(all.page).toBe(1);
    expect(all.responses.map((r) => r.sessionId)).toEqual(["ses_api_flagged", "ses_api_clean"]);

    // Flagged filter surfaces the reason.
    const flagged = (await (
      await get("/forms/frm_list_api/responses?flagged=true")
    ).json()) as ListBody;
    expect(flagged.responses.map((r) => r.sessionId)).toEqual(["ses_api_flagged"]);
    expect(flagged.responses[0]!.flaggedReason).toBe("HONEYPOT");

    // Date-range filter.
    const windowed = (await (
      await get("/forms/frm_list_api/responses?from=2026-02-05T00:00:00.000Z")
    ).json()) as ListBody;
    expect(windowed.responses.map((r) => r.sessionId)).toEqual(["ses_api_flagged"]);
  });

  it("surfaces every enumerated flag reason in the listing (task 026)", async () => {
    // The canonical anti-abuse vocabulary (HONEYPOT, MIN_TIME, RATE_ANOMALY) is
    // stored verbatim in flagged_reason and must be queryable via 023's listing.
    const formId = await seedForm("frm_reasons_api", [["stp_a", ["q_name"]]]);
    let i = 0;
    for (const reason of FLAG_REASONS) {
      await seedSubmitted({
        formId,
        sessionId: `ses_reason_${reason.toLowerCase()}`,
        entries: [{ questionId: "q_name", value: "x" }],
        submittedAt: new Date(`2026-03-0${String(++i)}T00:00:00.000Z`),
        flaggedReason: reason,
      });
    }
    const flagged = (await (
      await get("/forms/frm_reasons_api/responses?flagged=true")
    ).json()) as ListBody;
    const reasons = new Set(flagged.responses.map((r) => r.flaggedReason));
    expect(reasons).toEqual(
      new Set([FlagReason.HONEYPOT, FlagReason.MIN_TIME, FlagReason.RATE_ANOMALY]),
    );
  });

  it("returns full detail with the answer ledger and content hash", async () => {
    const formId = await seedForm("frm_detail_api", [["stp_a", ["q_name"]]]);
    const sessionId = await seedSubmitted({
      formId,
      sessionId: "ses_detail_api",
      entries: [{ questionId: "q_name", value: "Grace" }],
      submittedAt: new Date("2026-03-01T00:00:00.000Z"),
      contentHash: "f".repeat(64),
    });

    const res = await get(`/forms/frm_detail_api/responses/${sessionId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionId: string;
      contentHash: string;
      answers: Record<string, unknown>;
      ledger: unknown[];
    };
    expect(body.contentHash).toBe("f".repeat(64));
    expect(body.answers).toEqual({ q_name: "Grace" });
    // The ledger is present (a submitted, non-erased session).
    expect(Array.isArray(body.ledger)).toBe(true);
  });

  it("400s a malformed session id and 404s an unknown response", async () => {
    await seedForm("frm_404_api", [["stp_a", ["q_name"]]]);
    expect((await get("/forms/frm_404_api/responses/not-a-session")).status).toBe(400);
    expect((await get("/forms/frm_404_api/responses/ses_missing")).status).toBe(404);
  });
});

// --- exit criterion 2: CSV golden + JSON round-trip -------------------------

describe("CSV golden export + JSON round-trip (exit criterion 2)", () => {
  it("emits the byte-for-byte insurance CSV (BOM, quoting, multiChoice, column order)", async () => {
    const formId = await seedForm("frm_insurance", [
      ["stp_applicant", ["q_full_name", "q_age"]],
      ["stp_history", ["q_at_fault_accident", "q_coverage", "q_conditions"]],
    ]);
    const submittedAt = new Date("2026-03-15T09:00:00.000Z");
    await seedSubmitted({
      formId,
      sessionId: "ses_ins_001",
      submittedAt,
      entries: [
        { questionId: "q_full_name", value: "Doe, Jane" },
        { questionId: "q_age", value: 34 },
        { questionId: "q_at_fault_accident", value: false },
        { questionId: "q_coverage", value: "opt_gold" },
        {
          questionId: "q_conditions",
          value: ["opt_diabetes", "opt_asthma"] as unknown as AnswerValue,
        },
      ],
    });
    await seedSubmitted({
      formId,
      sessionId: "ses_ins_002",
      submittedAt,
      entries: [
        { questionId: "q_full_name", value: "Ada" },
        { questionId: "q_age", value: 29 },
        { questionId: "q_at_fault_accident", value: true },
        { questionId: "q_coverage", value: "opt_silver" },
        // q_conditions intentionally unanswered → empty cell.
      ],
    });

    const res = await get("/forms/frm_insurance/export?format=csv&version=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");

    // Read raw bytes: `Response.text()` strips a leading BOM (WHATWG UTF-8
    // decode), so a byte-for-byte assertion decodes with `ignoreBOM: true` to
    // keep the BOM the export actually emits.
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    const expected =
      "﻿" +
      "session_id,form_version,submitted_at,access_mode,q_full_name,q_age,q_at_fault_accident,q_coverage,q_conditions\r\n" +
      'ses_ins_001,1,2026-03-15T09:00:00.000Z,anonymous,"Doe, Jane",34,false,opt_gold,opt_diabetes;opt_asthma\r\n' +
      "ses_ins_002,1,2026-03-15T09:00:00.000Z,anonymous,Ada,29,true,opt_silver,\r\n";
    expect(text).toBe(expected);
    // The BOM is the first three bytes (EF BB BF) - present, exactly once.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("requires a version for CSV and 404s an unknown version", async () => {
    await seedForm("frm_csv_guard", [["stp_a", ["q_name"]]]);
    expect((await get("/forms/frm_csv_guard/export?format=csv")).status).toBe(400);
    expect((await get("/forms/frm_csv_guard/export?format=csv&version=9")).status).toBe(404);
  });

  it("JSON export round-trips canonical values as reporting rows", async () => {
    const formId = await seedForm("frm_json_api", [["stp_a", ["q_name", "q_pick"]]]);
    await seedSubmitted({
      formId,
      sessionId: "ses_json_1",
      submittedAt: new Date("2026-04-01T00:00:00.000Z"),
      entries: [
        { questionId: "q_name", value: "Ada" },
        { questionId: "q_pick", value: ["opt_a", "opt_b"] as unknown as AnswerValue },
      ],
    });

    const res = await get("/forms/frm_json_api/export?format=json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const rows = (await res.json()) as Array<{
      sessionId: string;
      formId: string;
      formVersion: number;
      answers: Record<string, unknown>;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.answers).toEqual({ q_name: "Ada", q_pick: ["opt_a", "opt_b"] });
    expect(rows[0]!.formId).toBe("frm_json_api");
  });
});

// --- exit criterion 3: streaming a large export -----------------------------

describe("large export streams without buffering the whole table (exit criterion 3)", () => {
  it("exports 10k responses in bounded chunks, no chunk near the document size", async () => {
    const formId = FormId.parse("frm_bulk");
    await seedForm("frm_bulk", [["stp_a", ["q_t"]]]);

    // Bulk-seed 10k submitted sessions + submissions via generate_series (one
    // statement each) - far faster than 30k helper calls, and enough to prove
    // the export never materializes the whole table in memory.
    await testDb.client.query(
      `insert into sessions (session_id, form_id, form_version, access_mode, status, expires_at, created_at)
       select 'ses_bulk_' || lpad(g::text, 6, '0'), $1, 1, 'anonymous', 'submitted', now() + interval '1 day', now()
       from generate_series(1, 10000) g`,
      [formId],
    );
    await testDb.client.query(
      `insert into submissions (session_id, content_hash, locked_answers, submitted_at)
       select 'ses_bulk_' || lpad(g::text, 6, '0'), repeat('0', 64),
              jsonb_build_object('answers',
                jsonb_build_array(jsonb_build_object('questionId', 'q_t', 'value', 'v' || g::text))),
              now()
       from generate_series(1, 10000) g`,
    );

    const res = await get("/forms/frm_bulk/export?format=csv&version=1");
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    let chunks = 0;
    let totalBytes = 0;
    let maxChunkBytes = 0;
    let dataRows = 0;
    const decoder = new TextDecoder();
    let carry = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += 1;
      totalBytes += value.byteLength;
      maxChunkBytes = Math.max(maxChunkBytes, value.byteLength);
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\r\n");
      carry = lines.pop() ?? "";
      dataRows += lines.length;
    }
    carry += decoder.decode();
    if (carry.length > 0) dataRows += 1;

    // header + 10000 data rows.
    expect(dataRows).toBe(10001);
    // Streamed, not buffered: delivered in many chunks, and the largest single
    // chunk is a small fraction of the whole document (bounded working set).
    expect(chunks).toBeGreaterThan(1);
    expect(maxChunkBytes * 4).toBeLessThan(totalBytes);
  });
});

// --- exit criterion 4: erase excludes everywhere; unflag releases event -----

describe("erase excludes from all read paths; unflag releases the event (exit criterion 4)", () => {
  async function outboxCount(sessionId: string): Promise<number> {
    const r = await testDb.client.query(
      `select count(*)::int as n from outbox where event_type = 'response.submitted' and payload->>'sessionId' = $1`,
      [sessionId],
    );
    return (r.rows[0] as { n: number }).n;
  }

  it("erases a session and excludes it from list, detail, export, then lists the tombstone", async () => {
    const formId = await seedForm("frm_erase_api", [["stp_a", ["q_name"]]]);
    const kept = await seedSubmitted({
      formId,
      sessionId: "ses_erase_kept",
      entries: [{ questionId: "q_name", value: "keep" }],
      submittedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    const erased = await seedSubmitted({
      formId,
      sessionId: "ses_erase_gone",
      entries: [{ questionId: "q_name", value: "secret" }],
      submittedAt: new Date("2026-05-02T00:00:00.000Z"),
    });

    // Erase.
    const eraseRes = await post(`/sessions/${erased}/erase`, { reason: "subject_request" });
    expect(eraseRes.status).toBe(200);
    const tombstone = (await eraseRes.json()) as { sessionId: string; alreadyErased: boolean };
    expect(tombstone.sessionId).toBe(erased);
    expect(tombstone.alreadyErased).toBe(false);

    // Excluded from list.
    const list = (await (await get("/forms/frm_erase_api/responses")).json()) as ListBody;
    expect(list.responses.map((r) => r.sessionId)).toEqual([kept]);
    expect(list.total).toBe(1);

    // Excluded from detail (404), while the kept one still resolves.
    expect((await get(`/forms/frm_erase_api/responses/${erased}`)).status).toBe(404);
    expect((await get(`/forms/frm_erase_api/responses/${kept}`)).status).toBe(200);

    // Excluded from export (JSON).
    const rows = (await (await get("/forms/frm_erase_api/export?format=json")).json()) as Array<{
      sessionId: string;
    }>;
    expect(rows.map((r) => r.sessionId)).toEqual([kept]);

    // Tombstone listed (compliance evidence).
    const erasures = (await (await get("/erasures?formId=frm_erase_api")).json()) as {
      erasures: Array<{ sessionId: string; reason: string }>;
    };
    expect(erasures.erasures.map((e) => e.sessionId)).toContain(erased);

    // Idempotent: erasing again is a no-op with alreadyErased:true.
    const again = await post(`/sessions/${erased}/erase`, { reason: "subject_request" });
    expect(((await again.json()) as { alreadyErased: boolean }).alreadyErased).toBe(true);
  });

  it("unflag releases the withheld response.submitted event exactly once", async () => {
    const formId = await seedForm("frm_unflag_api", [["stp_a", ["q_name"]]]);
    const sessionId = await seedSubmitted({
      formId,
      sessionId: "ses_unflag_api",
      entries: [{ questionId: "q_name", value: "review me" }],
      submittedAt: new Date("2026-06-01T00:00:00.000Z"),
      flaggedReason: "too_fast",
    });

    // Withheld at submit: no event yet.
    expect(await outboxCount(sessionId)).toBe(0);

    const first = await post(`/responses/${sessionId}/unflag`);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { released: boolean }).released).toBe(true);
    expect(await outboxCount(sessionId)).toBe(1);

    // The response is no longer flagged in the list.
    const flagged = (await (
      await get("/forms/frm_unflag_api/responses?flagged=true")
    ).json()) as ListBody;
    expect(flagged.responses.map((r) => r.sessionId)).not.toContain(sessionId);

    // Idempotent: a second unflag releases nothing and enqueues no duplicate.
    const second = await post(`/responses/${sessionId}/unflag`);
    expect(((await second.json()) as { released: boolean }).released).toBe(false);
    expect(await outboxCount(sessionId)).toBe(1);
  });

  it("404s unflag for a session with no submission", async () => {
    expect((await post("/responses/ses_no_submission/unflag")).status).toBe(404);
  });
});
