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
  GroupId,
  InstanceId,
  parseFormDefinition,
  QuestionId,
  SessionId,
} from "@roonga/qcms-core";
import type { AnswerValue, LockedSubmission } from "@roonga/qcms-core";
import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import {
  addInstances,
  createForm,
  createSession,
  insertFormVersion,
  insertSubmission,
  markSubmitted,
} from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
  DEFAULT_TEST_ENVIRONMENT,
} from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { FLAG_REASONS, FlagReason } from "../flag-reasons.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../../test-support.js";
import { registerAdminResponses } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
// A real better-auth session row seeded per suite (031): the admin-auth
// middleware verifies it against the database, so a made-up marker no longer
// authenticates anything.
let adminSessionToken: string;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, {
    groups: { admin: [registerAdminAuth, registerAdminResponses] },
  });
  internalToken = internalTokenFor(deps.config);
  adminSessionToken = (await seedAdminSession(testDb.db)).token;
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

// --- request helpers --------------------------------------------------------

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: adminSessionToken,
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
    // `visible` is read by `reporting.responses` for the live instance list, so even a
    // non-repeating fixture carries the shape a real `prepareSubmission` produces.
    flowState: {
      visible: entries.map((e) => ({ stepId: "stp_a", questionId: e.questionId })),
    },
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
    environment: DEFAULT_TEST_ENVIRONMENT,
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

  it("defuses a respondent answer a spreadsheet would execute on open (issue #470)", async () => {
    // The export path, not the helper: a free-text answer arrives from a public
    // portal, is stored, and comes back out as a cell an author opens in a
    // spreadsheet. Fixture text is deliberately inert and obvious (SEC-8) - what
    // is asserted is that no cell of the emitted file begins with a character a
    // spreadsheet reads as the start of a formula.
    const formId = await seedForm("frm_formula_guard", [
      ["stp_a", ["q_note", "q_score", "q_balance"]],
    ]);
    await seedSubmitted({
      formId,
      sessionId: "ses_formula_001",
      submittedAt: new Date("2026-03-15T09:00:00.000Z"),
      entries: [
        { questionId: "q_note", value: "=FIXTURE_PAYLOAD" },
        { questionId: "q_score", value: "@FIXTURE_PAYLOAD" },
        // Issue #476: a genuine negative number must survive as a number.
        { questionId: "q_balance", value: -5 },
      ],
    });

    const res = await get("/forms/frm_formula_guard/export?format=csv&version=1");
    expect(res.status).toBe(200);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      new Uint8Array(await res.arrayBuffer()),
    );

    expect(text).toContain(",'=FIXTURE_PAYLOAD,'@FIXTURE_PAYLOAD,-5\r\n");
    // No cell anywhere in the document opens with a formula lead, unless it is a
    // plain number, which cannot be evaluated as an expression. The header row is
    // included on purpose: a questionId cannot start with one today, and this is
    // the assertion that would notice if that ever changed. The split is the
    // naive one, which is sound here because this fixture quotes nothing.
    const cells = text
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .filter((line) => line.length > 0)
      .flatMap((line) => line.split(","));
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      if (/^-?\d+(?:\.\d+)?$/.test(cell)) continue;
      expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
    }
  });

  it("requires a version for CSV and 404s an unknown version", async () => {
    await seedForm("frm_csv_guard", [["stp_a", ["q_name"]]]);
    expect((await get("/forms/frm_csv_guard/export?format=csv")).status).toBe(400);
    expect((await get("/forms/frm_csv_guard/export?format=csv&version=9")).status).toBe(404);
  });

  it("400s a version filter above int4 rather than 500ing on the driver (#645)", async () => {
    // 2_147_483_648: one past the `form_versions.version` column's ceiling. The
    // filter used to reach Postgres, which refused the parameter as out of range,
    // so the request 500ed where every other unusable `version` value 400s. It is
    // now the same INVALID_QUERY refusal, on both routes that take the filter.
    await seedForm("frm_version_range", [["stp_a", ["q_name"]]]);

    const exported = await get("/forms/frm_version_range/export?format=csv&version=2147483648");
    expect(exported.status).toBe(400);
    expect(((await exported.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_QUERY",
    );

    const listed = await get("/forms/frm_version_range/responses?version=2147483648");
    expect(listed.status).toBe(400);
    expect(((await listed.json()) as { error: { code: string } }).error.code).toBe("INVALID_QUERY");

    // The in-range ceiling still reads as a real (absent) version, not a refusal.
    expect(
      (await get("/forms/frm_version_range/export?format=csv&version=2147483647")).status,
    ).toBe(404);
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
  /**
   * 60 s explicitly, rather than Vitest's inherited 5 s default (issue #871).
   *
   * Standalone this case takes about 0.6 s (616 ms measured 2026-09-10). What it
   * spends that on is two 10,000-row inserts into a containerised Postgres and a full
   * streamed read back, so the cost scales with whatever else the machine is doing
   * rather than with the behaviour under test: under a fully parallel `pnpm verify`
   * on a loaded host it failed on the 5 s default while this file took about 24 s,
   * then passed in isolation and in a forced cache-bypassed re-run. Seeding fewer
   * rows is not available as the fix - the assertions below want many chunks and a
   * largest chunk under a quarter of the document, which is exactly what a table
   * small enough to buffer would stop proving - so the budget moves instead. 60 s is
   * about a hundred times the standalone measurement, which is the margin
   * CONTRIBUTING asks for (issues #603, #604): far enough from the work that host
   * load cannot reach it, and still short enough that an export which never streams
   * fails.
   */
  it("exports 10k responses in bounded chunks, no chunk near the document size", async () => {
    const formId = FormId.parse("frm_bulk");
    await seedForm("frm_bulk", [["stp_a", ["q_t"]]]);

    // Bulk-seed 10k submitted sessions + submissions via generate_series (one
    // statement each) - far faster than 30k helper calls, and enough to prove
    // the export never materializes the whole table in memory.
    await testDb.client.query(
      `insert into sessions (session_id, form_id, form_version, access_mode, environment, status, expires_at, created_at)
       select 'ses_bulk_' || lpad(g::text, 6, '0'), $1, 1, 'anonymous', 'prod', 'submitted', now() + interval '1 day', now()
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
  }, 60_000);
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
    const eraseRes = await post(`/forms/frm_erase_api/responses/${erased}/erase`, {
      reason: "subject_request",
    });
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
    const again = await post(`/forms/frm_erase_api/responses/${erased}/erase`, {
      reason: "subject_request",
    });
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

    const first = await post(`/forms/frm_unflag_api/responses/${sessionId}/unflag`);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { released: boolean }).released).toBe(true);
    expect(await outboxCount(sessionId)).toBe(1);

    // The response is no longer flagged in the list.
    const flagged = (await (
      await get("/forms/frm_unflag_api/responses?flagged=true")
    ).json()) as ListBody;
    expect(flagged.responses.map((r) => r.sessionId)).not.toContain(sessionId);

    // Idempotent: a second unflag releases nothing and enqueues no duplicate.
    const second = await post(`/forms/frm_unflag_api/responses/${sessionId}/unflag`);
    expect(((await second.json()) as { released: boolean }).released).toBe(false);
    expect(await outboxCount(sessionId)).toBe(1);
  });

  /**
   * Both 404s, kept apart by their codes.
   *
   * #305 put the form-scoped session read ahead of the submission read, so an id
   * that names no session at all now stops at `SESSION_NOT_FOUND` rather than
   * falling through to `SUBMISSION_NOT_FOUND`. Seeding a real, in-form session that
   * genuinely has no submission is what keeps the second path covered - asserting
   * only the status would let either check answer for the other.
   */
  it("404s unflag for a real session that has no submission", async () => {
    const formId = await seedForm("frm_unflag_nosub", [["stp_a", ["q_name"]]]);
    const sessionId = SessionId.parse("ses_unflag_nosub");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId,
      formId,
      formVersion: 1,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const res = await post(`/forms/${formId}/responses/${sessionId}/unflag`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "SUBMISSION_NOT_FOUND",
    );
  });

  it("404s unflag for a session id that names nothing", async () => {
    const res = await post("/forms/frm_unflag_api/responses/ses_no_submission/unflag");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "SESSION_NOT_FOUND",
    );
  });
});

// --- form scope on the destructive operations (issue #305) ------------------

/**
 * `erase` and `unflag` used to act on whatever session id a client sent, with no
 * check that it belonged to a form the caller was acting within. Both now sit under
 * the form-scoped path the detail read always used, and the scope is enforced by the
 * query rather than by a comparison made afterwards.
 *
 * Each operation gets three assertions, because a guard that refuses everything and
 * a guard that checks nothing both pass a lone negative test:
 *
 *  1. a **positive** case, so the scope cannot be satisfied by blanket refusal;
 *  2. a **negative** case whose session genuinely exists under another form, which
 *     must 404 *and* leave the target untouched - a guard that refused only after
 *     mutating would pass the status assertion alone;
 *  3. a **fixture-is-real** assertion before the refusal, because a cross-form id
 *     that did not exist would make the negative case pass for the wrong reason.
 *
 * The 404 is the same one an unknown id takes, deliberately: telling "not yours"
 * from "not here" is itself a disclosure that someone else's response exists.
 */
describe("form scope on erase and unflag (issue #305)", () => {
  /** The submission row as the database holds it, or undefined when erased. */
  async function submissionRow(
    sessionId: string,
  ): Promise<{ flagged_reason: string | null; content_hash: string } | undefined> {
    const r = await testDb.client.query(
      `select flagged_reason, content_hash from submissions where session_id = $1`,
      [sessionId],
    );
    return r.rows[0] as { flagged_reason: string | null; content_hash: string } | undefined;
  }

  async function tombstones(sessionId: string): Promise<number> {
    const r = await testDb.client.query(
      `select count(*)::int as n from erasure_tombstones where session_id = $1`,
      [sessionId],
    );
    return (r.rows[0] as { n: number }).n;
  }

  async function releasedEvents(sessionId: string): Promise<number> {
    const r = await testDb.client.query(
      `select count(*)::int as n from outbox
        where event_type = 'response.submitted' and payload->>'sessionId' = $1`,
      [sessionId],
    );
    return (r.rows[0] as { n: number }).n;
  }

  it("erases a session named under its own form", async () => {
    const formId = await seedForm("frm_scope_erase_own", [["stp_a", ["q_name"]]]);
    const sessionId = await seedSubmitted({
      formId,
      sessionId: "ses_scope_erase_own",
      entries: [{ questionId: "q_name", value: "in scope" }],
      submittedAt: new Date("2026-06-02T00:00:00.000Z"),
    });

    const res = await post(`/forms/${formId}/responses/${sessionId}/erase`, {
      reason: "subject_request",
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { alreadyErased: boolean }).alreadyErased).toBe(false);
    expect(await tombstones(sessionId)).toBe(1);
  });

  it("404s an erase naming another form, and erases nothing", async () => {
    const owner = await seedForm("frm_scope_erase_owner", [["stp_a", ["q_name"]]]);
    const bystander = await seedForm("frm_scope_erase_other", [["stp_a", ["q_name"]]]);
    const sessionId = await seedSubmitted({
      formId: owner,
      sessionId: "ses_scope_erase_target",
      entries: [{ questionId: "q_name", value: "not yours to erase" }],
      submittedAt: new Date("2026-06-03T00:00:00.000Z"),
      contentHash: "a".repeat(64),
    });

    // Fixture-is-real: the session exists, is submitted, and is readable through
    // its own form. Without this the 404 below would be indistinguishable from
    // "there was never a row", and the test would pass for the wrong reason.
    const before = await submissionRow(sessionId);
    expect(before).toBeDefined();
    expect(before?.content_hash).toBe("a".repeat(64));
    expect((await get(`/forms/${owner}/responses/${sessionId}`)).status).toBe(200);

    // The other form asks to erase it.
    const res = await post(`/forms/${bystander}/responses/${sessionId}/erase`, {
      reason: "subject_request",
    });
    expect(res.status).toBe(404);

    // Refused *and* inert. The submission row is the exact thing erasure destroys,
    // so comparing it field for field against the pre-call snapshot is what rules
    // out a guard that refuses only after mutating. No tombstone was written, and
    // the response still reads through its owning form.
    expect(await tombstones(sessionId)).toBe(0);
    expect(await submissionRow(sessionId)).toEqual(before);
    expect((await get(`/forms/${owner}/responses/${sessionId}`)).status).toBe(200);

    // And the owning form can still erase it, so the guard refused the caller
    // rather than breaking the operation.
    const owned = await post(`/forms/${owner}/responses/${sessionId}/erase`, {
      reason: "subject_request",
    });
    expect(owned.status).toBe(200);
    expect(await tombstones(sessionId)).toBe(1);
    expect(await submissionRow(sessionId)).toBeUndefined();

    // The idempotency step is scoped too, and this is the only assertion that can
    // show it. `eraseSession` looks for an existing tombstone *before* it looks for
    // the session, and returns it as `200 alreadyErased: true`. With that lookup
    // unscoped, the other form now gets that 200 for a session it does not own -
    // which discloses both that the session exists and that it has been erased,
    // the exact leak this issue exists to close. A same-form repeat cannot catch
    // it, and until now every alreadyErased assertion in the repo was same-form.
    const afterErasure = await post(`/forms/${bystander}/responses/${sessionId}/erase`, {
      reason: "subject_request",
    });
    expect(afterErasure.status).toBe(404);
    expect(await tombstones(sessionId)).toBe(1);
  });

  it("unflags a session named under its own form", async () => {
    const formId = await seedForm("frm_scope_unflag_own", [["stp_a", ["q_name"]]]);
    const sessionId = await seedSubmitted({
      formId,
      sessionId: "ses_scope_unflag_own",
      entries: [{ questionId: "q_name", value: "in scope" }],
      submittedAt: new Date("2026-06-04T00:00:00.000Z"),
      flaggedReason: "too_fast",
    });

    const res = await post(`/forms/${formId}/responses/${sessionId}/unflag`);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { released: boolean }).released).toBe(true);
    expect((await submissionRow(sessionId))?.flagged_reason).toBeNull();
    expect(await releasedEvents(sessionId)).toBe(1);
  });

  it("404s an unflag naming another form, and releases nothing", async () => {
    const owner = await seedForm("frm_scope_unflag_owner", [["stp_a", ["q_name"]]]);
    const bystander = await seedForm("frm_scope_unflag_other", [["stp_a", ["q_name"]]]);
    const sessionId = await seedSubmitted({
      formId: owner,
      sessionId: "ses_scope_unflag_target",
      entries: [{ questionId: "q_name", value: "still withheld" }],
      submittedAt: new Date("2026-06-05T00:00:00.000Z"),
      flaggedReason: "too_fast",
    });

    // Fixture-is-real: a genuinely flagged, genuinely withheld submission. If it
    // were absent, or already released, the assertions below would prove nothing.
    expect((await submissionRow(sessionId))?.flagged_reason).toBe("too_fast");
    expect(await releasedEvents(sessionId)).toBe(0);

    const res = await post(`/forms/${bystander}/responses/${sessionId}/unflag`);
    expect(res.status).toBe(404);

    // Refused *and* inert: the flag still stands and no event escaped.
    expect((await submissionRow(sessionId))?.flagged_reason).toBe("too_fast");
    expect(await releasedEvents(sessionId)).toBe(0);

    // And the owning form can still release it, so the guard refused the caller
    // rather than breaking the operation.
    expect((await post(`/forms/${owner}/responses/${sessionId}/unflag`)).status).toBe(200);
    expect(await releasedEvents(sessionId)).toBe(1);
  });
});

// --- task 075: both CSV shapes for a repeating group ------------------------

/**
 * Acceptance cases 46, 47 and 48 of `plan/repeating-groups-and-table-input.md`
 * section 11, through the real route against the real reporting view: the long
 * shape's zip, the wide shape's indexed header and its dependence on the
 * version's `max`, and the unchanged single file for a form with no group.
 */

/** A one-group form definition: `q_booking_ref`, then `grp_passengers`, then `q_notes`. */
function repeatFormDefinition(formId: string, max: number): FormDefinition {
  const parsed = parseFormDefinition({
    formId,
    defaultLocale: "en",
    title: { en: "A booking" },
    steps: [
      {
        stepId: "stp_booking",
        title: { en: "Booking" },
        items: [{ questionId: "q_booking_ref", version: 1 }],
      },
      {
        stepId: "stp_pax",
        title: { en: "Passengers" },
        items: [
          {
            groupId: "grp_passengers",
            label: { en: "Passengers" },
            instanceLabel: { en: "Passenger {n}" },
            items: [
              { questionId: "q_name", version: 1 },
              { questionId: "q_meal", version: 1 },
            ],
            count: { source: "open", min: 0, max },
          },
          { questionId: "q_notes", version: 1 },
        ],
      },
    ],
    rules: [],
  });
  if (!parsed.ok) throw new Error(`repeat fixture ${formId} did not parse`);
  return parsed.value;
}

/** Create the form and publish one version per `max` given, in order. */
async function seedRepeatForm(formId: string, maxima: readonly number[]): Promise<FormId> {
  const id = FormId.parse(formId);
  await createForm(testDb.db, { formId: id, slug: formId.replace(/_/g, "-"), defaultLocale: "en" });
  for (const max of maxima) {
    await insertFormVersion(testDb.db, {
      formId: id,
      definition: repeatFormDefinition(formId, max),
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });
  }
  return id;
}

/**
 * A submitted session with a roster and instanced locked answers.
 *
 * The roster rows are not decoration: a `LockedAnswer` names its instance and not
 * its group, so `reporting.responses` resolves the group from
 * `answer_group_instances`. A fixture without them would export no group rows at
 * all, which is the failure this test would otherwise mistake for a pass.
 */
async function seedRepeatSubmitted(opts: {
  formId: FormId;
  formVersion: number;
  sessionId: string;
  instances: ReadonlyArray<{ instanceId: string; name?: string; meal?: string[] }>;
  outside: Record<string, AnswerValue>;
}): Promise<SessionId> {
  const sessionId = SessionId.parse(opts.sessionId);
  await createSession(testDb.db, {
    environment: DEFAULT_TEST_ENVIRONMENT,
    sessionId,
    formId: opts.formId,
    formVersion: opts.formVersion,
    accessMode: "anonymous",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await markSubmitted(testDb.db, sessionId);
  await addInstances(testDb.db, {
    sessionId,
    groupId: GroupId.parse("grp_passengers"),
    instanceIds: opts.instances.map((i) => InstanceId.parse(i.instanceId)),
    occurredAt: new Date("2026-05-01T00:00:00.000Z"),
  });
  const answers = [
    ...Object.entries(opts.outside).map(([questionId, value]) => ({
      questionId: QuestionId.parse(questionId),
      value,
    })),
    ...opts.instances.flatMap((instance) => [
      ...(instance.name === undefined
        ? []
        : [
            {
              questionId: QuestionId.parse("q_name"),
              instanceId: InstanceId.parse(instance.instanceId),
              value: instance.name,
            },
          ]),
      ...(instance.meal === undefined
        ? []
        : [
            {
              questionId: QuestionId.parse("q_meal"),
              instanceId: InstanceId.parse(instance.instanceId),
              value: instance.meal as unknown as AnswerValue,
            },
          ]),
    ]),
  ];
  await insertSubmission(testDb.db, {
    sessionId,
    contentHash: "0".repeat(64),
    lockedAnswers: {
      answers,
      // Every live instance was shown, whether or not it was answered: an instance with
      // `name: null` below is one a respondent added and left blank, which is still
      // live (ADR-42) and is where the view's instance list has to come from.
      flowState: {
        visible: [
          ...Object.keys(opts.outside).map((questionId) => ({ stepId: "stp_booking", questionId })),
          ...opts.instances.flatMap((instance) =>
            ["q_name", "q_meal"].map((questionId) => ({
              stepId: "stp_pax",
              questionId,
              instanceId: instance.instanceId,
            })),
          ),
        ],
      },
      contentHash: "0".repeat(64),
    } as unknown as LockedSubmission,
    submittedAt: new Date("2026-05-01T00:00:00.000Z"),
  });
  return sessionId;
}

/**
 * The archive's entries as text, read from the central directory the way a reader
 * does. Written here rather than shelled out to `unzip` so the test has no tool
 * dependency; the record layout itself is covered by `@roonga/qcms-csv`'s own tests.
 */
function readZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decode = (from: number, length: number): string =>
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(from, from + length));
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50) throw new Error("not a zip");
  const files = new Map<string, string>();
  let at = view.getUint32(end + 16, true);
  for (let left = view.getUint16(end + 10, true); left > 0; left -= 1) {
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const dataAt = local + 30 + view.getUint16(local + 26, true);
    files.set(decode(at + 46, nameLength), decode(dataAt, size));
    at += 46 + nameLength;
  }
  return files;
}

async function exportBytes(path: string): Promise<{ res: Response; bytes: Uint8Array }> {
  const res = await get(path);
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

describe("CSV export of a repeating group, both shapes (cases 46 to 48)", () => {
  let formId: FormId;

  beforeAll(async () => {
    // Two published versions of one form, differing only in the group's `max`:
    // v1 allows two passengers, v2 allows four. That is what case 47 needs.
    formId = await seedRepeatForm("frm_booking", [2, 4]);
    await seedRepeatSubmitted({
      formId,
      formVersion: 1,
      sessionId: "ses_book_001",
      outside: { q_booking_ref: "ABC123", q_notes: "window seats" },
      instances: [
        { instanceId: "ins_pax_a", name: "Ada", meal: ["opt_vegan"] },
        { instanceId: "ins_pax_b", name: "Lovelace, Grace", meal: ["opt_halal", "opt_kosher"] },
      ],
    });
    await seedRepeatSubmitted({
      formId,
      formVersion: 1,
      sessionId: "ses_book_002",
      outside: { q_booking_ref: "=FIXTURE_PAYLOAD" },
      instances: [{ instanceId: "ins_pax_c", name: "@FIXTURE_PAYLOAD" }],
    });
    // A booking whose FIRST passenger was added and left blank. Still a live instance
    // (ADR-42), so it owes a row of its own and must not renumber the one after it.
    //
    // Two instances rather than three, and that is deliberate: v1 declares `max: 2`,
    // so three is a state the API refuses (SEC-16) and a fixture in it would be
    // asserting the export's behaviour on something the system cannot produce.
    await seedRepeatSubmitted({
      formId,
      formVersion: 1,
      sessionId: "ses_book_003",
      outside: { q_booking_ref: "DEF456" },
      instances: [{ instanceId: "ins_pax_d" }, { instanceId: "ins_pax_e", name: "Grace" }],
    });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("case 46: the long shape is a zip of responses.csv and one group file, joinable on session_id", async () => {
    const { res, bytes } = await exportBytes("/forms/frm_booking/export?format=csv&version=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="frm_booking-v1-responses.zip"',
    );

    const files = readZip(bytes);
    expect([...files.keys()]).toEqual(["responses.csv", "grp_passengers.csv"]);

    // The flat file carries the metadata columns and the questions OUTSIDE the
    // group, and nothing of the group at all.
    expect(files.get("responses.csv")).toBe(
      "﻿session_id,form_version,submitted_at,access_mode,q_booking_ref,q_notes\r\n" +
        "ses_book_001,1,2026-05-01T00:00:00.000Z,anonymous,ABC123,window seats\r\n" +
        "ses_book_002,1,2026-05-01T00:00:00.000Z,anonymous,'=FIXTURE_PAYLOAD,\r\n" +
        "ses_book_003,1,2026-05-01T00:00:00.000Z,anonymous,DEF456,\r\n",
    );

    // The group file is one row per (session, live instance), joinable on session_id,
    // with the guard applied there too. `ses_book_003`'s first passenger is the one
    // that matters: added, left blank, still live, so it owes an ordinal-1 row of empty
    // cells and the passenger after it is 2 rather than 1.
    expect(files.get("grp_passengers.csv")).toBe(
      "﻿session_id,instance_ordinal,instance_id,q_name,q_meal\r\n" +
        "ses_book_001,1,ins_pax_a,Ada,opt_vegan\r\n" +
        'ses_book_001,2,ins_pax_b,"Lovelace, Grace",opt_halal;opt_kosher\r\n' +
        "ses_book_002,1,ins_pax_c,'@FIXTURE_PAYLOAD,\r\n" +
        "ses_book_003,1,ins_pax_d,,\r\n" +
        "ses_book_003,2,ins_pax_e,Grace,\r\n",
    );

    // Joinable: every group row's session is a row of the flat file.
    const sessions = new Set(
      files
        .get("responses.csv")!
        .split("\r\n")
        .slice(1)
        .filter((line) => line !== "")
        .map((line) => line.split(",")[0]),
    );
    for (const line of files.get("grp_passengers.csv")!.split("\r\n").slice(1)) {
      if (line === "") continue;
      expect(sessions.has(line.split(",")[0])).toBe(true);
    }
  });

  it("case 47: the wide shape is one flat file whose header follows the version's max", async () => {
    const narrow = await exportBytes("/forms/frm_booking/export?format=csv&shape=wide&version=1");
    expect(narrow.res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(narrow.res.headers.get("content-disposition")).toBe(
      'attachment; filename="frm_booking-v1-responses.csv"',
    );
    const narrowText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(narrow.bytes);
    expect(narrowText).toBe(
      "﻿session_id,form_version,submitted_at,access_mode,q_booking_ref," +
        "q_name__1,q_name__2,q_meal__1,q_meal__2,q_notes\r\n" +
        'ses_book_001,1,2026-05-01T00:00:00.000Z,anonymous,ABC123,Ada,"Lovelace, Grace",' +
        "opt_vegan,opt_halal;opt_kosher,window seats\r\n" +
        "ses_book_002,1,2026-05-01T00:00:00.000Z,anonymous,'=FIXTURE_PAYLOAD," +
        "'@FIXTURE_PAYLOAD,,,,\r\n" +
        // The blank first instance holds its indexed SLOT rather than being skipped, so
        // the named passenger is in `q_name__2` and not in `q_name__1`. The wide shape
        // addresses an instance by position, so a blank one has to keep its position or
        // every later column would mean a different passenger.
        "ses_book_003,1,2026-05-01T00:00:00.000Z,anonymous,DEF456,,Grace,,,\r\n",
    );

    // The same form at a version whose `max` is higher: four slots per member
    // question instead of two, silently from a consumer's point of view. This is
    // the documented consequence of Q17, asserted rather than warned about, and it
    // is why the route requires a version and the screen says to pin it.
    const wider = await exportBytes("/forms/frm_booking/export?format=csv&shape=wide&version=2");
    const widerHeader = new TextDecoder("utf-8", { ignoreBOM: true })
      .decode(wider.bytes)
      .split("\r\n")[0];
    expect(widerHeader).toBe(
      "﻿session_id,form_version,submitted_at,access_mode,q_booking_ref," +
        "q_name__1,q_name__2,q_name__3,q_name__4," +
        "q_meal__1,q_meal__2,q_meal__3,q_meal__4,q_notes",
    );
  });

  it("refuses an unknown shape rather than silently exporting the default", async () => {
    expect((await get("/forms/frm_booking/export?format=csv&shape=tall&version=1")).status).toBe(
      400,
    );
  });

  it("case 48: a form with no group is byte-identical in either shape", async () => {
    // The insurance fixture of exit criterion 2 above, requested in both shapes:
    // the same single `text/csv` file, the same name, the same bytes. No existing
    // adopter's pipeline moves, and `shape=wide` is not a second format for a form
    // that has nothing to fold in.
    const long = await exportBytes("/forms/frm_insurance/export?format=csv&version=1");
    const wide = await exportBytes("/forms/frm_insurance/export?format=csv&shape=wide&version=1");
    const explicitlyLong = await exportBytes(
      "/forms/frm_insurance/export?format=csv&shape=long&version=1",
    );
    for (const got of [wide, explicitlyLong]) {
      expect(got.res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(got.res.headers.get("content-disposition")).toBe(
        long.res.headers.get("content-disposition"),
      );
      expect([...got.bytes]).toEqual([...long.bytes]);
    }
    // And it is still today's file, not merely three identical new ones.
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(long.bytes)).toContain(
      "session_id,form_version,submitted_at,access_mode," +
        "q_full_name,q_age,q_at_fault_accident,q_coverage,q_conditions\r\n",
    );
  });

  it("JSON export carries the group's instances inside answers", async () => {
    // JSON spans versions and takes no shape: it emits the reporting row as it
    // stands, which since migration 0025 carries the group's ordered array.
    const res = await get("/forms/frm_booking/export?format=json");
    const rows = (await res.json()) as Array<{
      sessionId: string;
      answers: Record<string, unknown>;
    }>;
    const row = rows.find((r) => r.sessionId === "ses_book_001")!;
    expect(row.answers["grp_passengers"]).toEqual([
      { instance_id: "ins_pax_a", q_name: "Ada", q_meal: ["opt_vegan"] },
      { instance_id: "ins_pax_b", q_name: "Lovelace, Grace", q_meal: ["opt_halal", "opt_kosher"] },
    ]);
  });
});
