import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import { FormId, GroupId, InstanceId, QuestionId, SessionId } from "@roonga/qcms-core";
import type { AnswerValue, FormDefinition, LockedSubmission } from "@roonga/qcms-core";

import { reportingViewColumns } from "../reporting-views.js";
import { erasureTombstones } from "../schema/index.js";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
  DEFAULT_TEST_ENVIRONMENT,
} from "../testing/harness.js";
import {
  addInstances,
  appendAnswer,
  createForm,
  createSession,
  getSession,
  insertFormVersion,
  insertSubmission,
  markInProgress,
  markSubmitted,
  purgeExpired,
  sweepExpiredSessions,
} from "./index.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;

/** Seed a form + one published version so sessions have valid FKs. */
async function seedForm(id: string): Promise<{ formId: FormId; version: number }> {
  const formId = FormId.parse(id);
  await createForm(testDb.db, { formId, slug: `${id}-slug`, defaultLocale: "en" });
  const v = await insertFormVersion(testDb.db, {
    formId,
    definition: emptyDef,
    compiled: emptyCompiled,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  });
  return { formId, version: v.version };
}

/**
 * Build a LockedSubmission whose canonical answers key by questionId, and by
 * instance where one is given (task 071's optional `LockedAnswer.instanceId`).
 *
 * The `instanceId` key is **absent** rather than `undefined` when the entry has
 * none, which is the property the byte-identical claim for a non-repeating form
 * rests on: `canonicalJson` omits an `undefined` member, so the two spellings
 * hash the same, but the stored JSONB would not hold the same bytes.
 */
function lockedSubmission(
  entries: ReadonlyArray<{ questionId: string; instanceId?: string; value: AnswerValue }>,
  extraVisible: ReadonlyArray<{ stepId: string; questionId: string; instanceId?: string }> = [],
): LockedSubmission {
  return {
    answers: entries.map((e) => ({
      questionId: QuestionId.parse(e.questionId),
      ...(e.instanceId === undefined ? {} : { instanceId: InstanceId.parse(e.instanceId) }),
      value: e.value,
    })),
    // `flowState.visible` is NOT opaque to the view: it is where the LIVE instance
    // list comes from, because an instance can be live with no answer at all. So the
    // fixture carries one visible entry per answered cell, in the same order, which
    // is what a real `prepareSubmission` produces for a session that answered
    // everything it was shown. A blank live instance is seeded by passing an entry
    // list that names it in `extraVisible` instead.
    flowState: {
      visible: [
        ...entries.map((e) => ({
          stepId: "stp_one",
          questionId: e.questionId,
          ...(e.instanceId === undefined ? {} : { instanceId: e.instanceId }),
        })),
        ...extraVisible,
      ],
    },
    contentHash: "0".repeat(64),
  } as unknown as LockedSubmission;
}

/** Create a submitted session with a submission lock holding `entries`. */
async function seedSubmitted(
  formId: FormId,
  version: number,
  sessionId: SessionId,
  entries: ReadonlyArray<{ questionId: string; instanceId?: string; value: AnswerValue }>,
  accessMode: "anonymous" | "secure_link" = "anonymous",
): Promise<void> {
  await createSession(testDb.db, {
    environment: DEFAULT_TEST_ENVIRONMENT,
    sessionId,
    formId,
    formVersion: version,
    accessMode,
    // Secure-link sessions need a linkId FK; keep the view tests on anonymous.
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await markSubmitted(testDb.db, sessionId);
  await insertSubmission(testDb.db, {
    sessionId,
    contentHash: "0".repeat(64),
    lockedAnswers: lockedSubmission(entries),
    submittedAt: new Date("2026-01-02T03:04:05.000Z"),
  });
}

describe("reporting.responses view", () => {
  it("shows submitted sessions with answers keyed by questionId; hides others", async () => {
    const { formId, version } = await seedForm("frm_report");

    const submitted = SessionId.parse("ses_report_submitted");
    await seedSubmitted(formId, version, submitted, [
      { questionId: "q_text", value: "hello" },
      { questionId: "q_num", value: 42 },
      { questionId: "q_bool", value: true },
      { questionId: "q_multi", value: ["opt_a", "opt_b"] as unknown as AnswerValue },
    ]);

    // in_progress: future expiry so the sweep below never touches it.
    const inProgress = SessionId.parse("ses_report_inprogress");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: inProgress,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await markInProgress(testDb.db, inProgress);

    // expired: past expiry, then swept to `expired`.
    const expired = SessionId.parse("ses_report_expired");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: expired,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() - 1000),
    });
    await sweepExpiredSessions(testDb.db, new Date());
    expect((await getSession(testDb.db, expired))?.status).toBe("expired");

    const rows = await testDb.client.query<{ session_id: string }>(
      `select session_id from reporting.responses where form_id = $1`,
      [formId],
    );
    const ids = rows.rows.map((r) => r.session_id);
    expect(ids).toContain(submitted);
    expect(ids).not.toContain(inProgress);
    expect(ids).not.toContain(expired);
  });

  it("JSONB answers match the locked submission exactly", async () => {
    const res = await testDb.client.query<{
      answers: Record<string, unknown>;
      access_mode: string;
      form_version: number;
    }>(`select answers, access_mode, form_version from reporting.responses where session_id = $1`, [
      "ses_report_submitted",
    ]);
    expect(res.rowCount).toBe(1);
    expect(res.rows[0]!.answers).toEqual({
      q_text: "hello",
      q_num: 42,
      q_bool: true,
      q_multi: ["opt_a", "opt_b"],
    });
    expect(res.rows[0]!.access_mode).toBe("anonymous");
  });

  it("excludes erased sessions by the tombstone anti-join", async () => {
    const { formId, version } = await seedForm("frm_erased");
    const erased = SessionId.parse("ses_erased");
    await seedSubmitted(formId, version, erased, [{ questionId: "q_text", value: "secret" }]);

    // The submission row still exists (016's delete path is not built yet); the
    // tombstone alone must remove the row from the view.
    await testDb.db.insert(erasureTombstones).values({
      sessionId: erased,
      formId,
      formVersion: version,
      reason: "subject_request",
    });

    const res = await testDb.client.query(
      `select session_id from reporting.responses where session_id = $1`,
      [erased],
    );
    expect(res.rowCount).toBe(0);
  });
});

describe("reporting.answers_flat view", () => {
  it("emits one row per (submitted session, questionId, value)", async () => {
    const res = await testDb.client.query<{ question_id: string; value: unknown }>(
      `select question_id, value from reporting.answers_flat where session_id = $1 order by question_id`,
      ["ses_report_submitted"],
    );
    expect(res.rows).toEqual([
      { question_id: "q_bool", value: true },
      { question_id: "q_multi", value: ["opt_a", "opt_b"] },
      { question_id: "q_num", value: 42 },
      { question_id: "q_text", value: "hello" },
    ]);
  });

  it("inherits the submitted-only, non-erased exclusion from reporting.responses", async () => {
    // The erased session contributes no flat rows either.
    const res = await testDb.client.query(
      `select 1 from reporting.answers_flat where session_id = $1`,
      ["ses_erased"],
    );
    expect(res.rowCount).toBe(0);
  });

  it("reports a null instance_id for every answer outside a group", async () => {
    const res = await testDb.client.query<{ question_id: string; instance_id: string | null }>(
      `select question_id, instance_id from reporting.answers_flat
        where session_id = $1 order by question_id`,
      ["ses_report_submitted"],
    );
    expect(res.rows.map((r) => r.instance_id)).toEqual([null, null, null, null]);
  });
});

// --- repeating groups (task 075, Q18; acceptance cases 49 and 50) -----------

describe("the reporting views carry repeated answers", () => {
  const groupId = GroupId.parse("grp_passengers");
  const first = InstanceId.parse("ins_p1");
  const second = InstanceId.parse("ins_p2");
  const sessionId = SessionId.parse("ses_repeat_report");

  beforeAll(async () => {
    const { formId, version } = await seedForm("frm_repeat_report");
    await createSession(testDb.db, {
      sessionId,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await markSubmitted(testDb.db, sessionId);
    // The roster is what tells the view which group an instance belongs to: a
    // LockedAnswer names the instance and not the group.
    await addInstances(testDb.db, {
      sessionId,
      groupId,
      instanceIds: [first, second],
      occurredAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    await insertSubmission(testDb.db, {
      sessionId,
      contentHash: "0".repeat(64),
      // Document order for questions, roster order for instances (ADR-42 5.3).
      lockedAnswers: lockedSubmission([
        { questionId: "q_booking_ref", value: "ABC123" },
        { questionId: "q_name", instanceId: first, value: "Ada" },
        { questionId: "q_meal", instanceId: first, value: ["opt_vegan"] as unknown as AnswerValue },
        { questionId: "q_name", instanceId: second, value: "Grace" },
        {
          questionId: "q_meal",
          instanceId: second,
          value: ["opt_halal"] as unknown as AnswerValue,
        },
      ]),
      submittedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("keeps BOTH answers for one repeated questionId (the jsonb_object_agg fix)", async () => {
    // The assertion this task exists for. Before the fix, `jsonb_object_agg` kept
    // ONE of the two `q_name` answers, with no error and no warning, so this read
    // returned a single scalar under `q_name` and the second passenger's name was
    // gone from every reporting consumer and every export.
    const res = await testDb.client.query<{ answers: Record<string, unknown> }>(
      `select answers from reporting.responses where session_id = $1`,
      [sessionId],
    );
    expect(res.rows[0]!.answers).toEqual({
      q_booking_ref: "ABC123",
      grp_passengers: [
        { instance_id: "ins_p1", q_name: "Ada", q_meal: ["opt_vegan"] },
        { instance_id: "ins_p2", q_name: "Grace", q_meal: ["opt_halal"] },
      ],
    });
  });

  it("shows the pre-075 aggregate losing one of them, against the same row", async () => {
    // The same expression migration 0003 shipped, run against the submission the
    // test above reads. It is here because the failure this task fixes is SILENT:
    // nothing threw, nothing warned, and the only way to see it is to watch the
    // old aggregate hand back one answer where two were locked. Keeping it pins
    // the reason the view is shaped the way it is now.
    const res = await testDb.client.query<{ answers: Record<string, unknown> }>(
      `select (
         select jsonb_object_agg("elem"."item" ->> 'questionId', "elem"."item" -> 'value')
           from jsonb_array_elements("sub"."locked_answers" -> 'answers') as "elem"("item")
       ) as answers
       from submissions "sub" where "sub"."session_id" = $1`,
      [sessionId],
    );
    const collapsed = res.rows[0]!.answers;
    expect(Object.keys(collapsed).sort()).toEqual(["q_booking_ref", "q_meal", "q_name"]);
    // One scalar where two passengers answered, and no trace of the other.
    expect(collapsed["q_name"]).toBe("Grace");
  });

  it("orders the group's array by the locked set's roster order", async () => {
    const res = await testDb.client.query<{ ids: string[] }>(
      `select array_agg(inst ->> 'instance_id' order by ord) as ids
         from reporting.responses r,
              jsonb_array_elements(r.answers -> 'grp_passengers') with ordinality as e(inst, ord)
        where r.session_id = $1`,
      [sessionId],
    );
    expect(res.rows[0]!.ids).toEqual(["ins_p1", "ins_p2"]);
  });

  it("unpivots to one answers_flat row per (session, question, instance)", async () => {
    const res = await testDb.client.query<{
      question_id: string;
      instance_id: string | null;
      value: unknown;
    }>(
      `select question_id, instance_id, value from reporting.answers_flat
        where session_id = $1
        order by instance_id nulls first, question_id`,
      [sessionId],
    );
    expect(res.rows).toEqual([
      { question_id: "q_booking_ref", instance_id: null, value: "ABC123" },
      { question_id: "q_meal", instance_id: "ins_p1", value: ["opt_vegan"] },
      { question_id: "q_name", instance_id: "ins_p1", value: "Ada" },
      { question_id: "q_meal", instance_id: "ins_p2", value: ["opt_halal"] },
      { question_id: "q_name", instance_id: "ins_p2", value: "Grace" },
    ]);
  });

  it("keeps a multiChoice selection as one row, not one row per option", async () => {
    // The group array and a multiChoice value are both JSONB arrays, so the
    // unpivot tells them apart structurally (an array of objects against an array
    // of option id strings). Getting that wrong would silently change the grain
    // of every multiChoice answer in the long projection.
    const res = await testDb.client.query<{ count: string }>(
      `select count(*)::text as count from reporting.answers_flat
        where session_id = $1 and question_id = 'q_meal'`,
      [sessionId],
    );
    expect(res.rows[0]!.count).toBe("2");
  });

  it("keeps a LIVE instance that holds no answer at all, in its roster position", async () => {
    // An instance a respondent added and left blank is still live (ADR-42) - that is
    // what makes "Add passenger" a thing a respondent can see happen - and a group whose
    // members are all optional can submit one. Deriving the instance list from `answers`
    // would drop it and shift every later instance's ordinal by one in the long CSV
    // shape, so the list comes from the submission's own `flowState.visible` instead.
    const { formId, version } = await seedForm("frm_repeat_blank");
    const blankSession = SessionId.parse("ses_repeat_blank");
    const middle = InstanceId.parse("ins_blank");
    await createSession(testDb.db, {
      sessionId: blankSession,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await markSubmitted(testDb.db, blankSession);
    await addInstances(testDb.db, {
      sessionId: blankSession,
      groupId,
      instanceIds: [first, middle, second],
      occurredAt: new Date("2026-05-02T00:00:00.000Z"),
    });
    await insertSubmission(testDb.db, {
      sessionId: blankSession,
      contentHash: "0".repeat(64),
      lockedAnswers: lockedSubmission(
        [
          { questionId: "q_name", instanceId: first, value: "Ada" },
          { questionId: "q_name", instanceId: second, value: "Grace" },
        ],
        // The blank instance was shown and answered nothing, so it is visible and
        // absent from `answers`. It sits BETWEEN the two answered ones in roster order.
        [{ stepId: "stp_one", questionId: "q_name", instanceId: middle }],
      ),
      submittedAt: new Date("2026-05-02T00:00:00.000Z"),
    });

    const res = await testDb.client.query<{ answers: Record<string, unknown> }>(
      `select answers from reporting.responses where session_id = $1`,
      [blankSession],
    );
    expect(res.rows[0]!.answers).toEqual({
      grp_passengers: [
        { instance_id: "ins_p1", q_name: "Ada" },
        { instance_id: "ins_p2", q_name: "Grace" },
        // Only its id: live, shown, and answered nothing.
        { instance_id: "ins_blank" },
      ],
    });
    // So the array's length is the group's live instance count for this session.
    const counted = await testDb.client.query<{ n: number }>(
      `select jsonb_array_length(answers -> 'grp_passengers') as n
         from reporting.responses where session_id = $1`,
      [blankSession],
    );
    expect(counted.rows[0]!.n).toBe(3);
    // And it contributes no answers_flat row, because it holds no answer.
    const flat = await testDb.client.query(
      `select 1 from reporting.answers_flat where session_id = $1 and instance_id = 'ins_blank'`,
      [blankSession],
    );
    expect(flat.rowCount).toBe(0);
  });

  it("leaves a form with no group byte-identical (acceptance cases 49 and 50)", async () => {
    // Byte-identical rather than merely equal: `answers::text` is the stored
    // JSONB's own rendering, so this fails if the view starts emitting a nested
    // array, a null `instance_id` member or a reordered object for a
    // non-repeating form.
    const res = await testDb.client.query<{ answers: string }>(
      `select answers::text as answers from reporting.responses where session_id = $1`,
      ["ses_report_submitted"],
    );
    expect(res.rows[0]!.answers).toBe(
      '{"q_num": 42, "q_bool": true, "q_text": "hello", "q_multi": ["opt_a", "opt_b"]}',
    );
  });
});

describe("reporting contract - no column drift", () => {
  // The documented contract in docs/reporting-view.md. Assert the live view
  // column lists (ordinal order) match, so the doc can never silently drift.
  //
  // Since task 075 the expected lists come from `reportingViewColumns`, the same
  // module the migration body is generated from, rather than from a literal here.
  // Under ADR-40 the view set is per environment and after task 068 per
  // workspace, so a literal in a test would have to be duplicated per schema the
  // moment there is more than one - and a duplicate is what drifts.
  const EXPECTED: Record<string, string[]> = Object.fromEntries(
    reportingViewColumns.map((view) => [view.name, [...view.columns]]),
  );

  it("matches the live reporting schema view columns", async () => {
    const res = await testDb.client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'reporting'
        order by table_name, ordinal_position`,
    );
    const live: Record<string, string[]> = {};
    for (const row of res.rows) {
      const cols = live[row.table_name] ?? [];
      cols.push(row.column_name);
      live[row.table_name] = cols;
    }
    expect(live).toEqual(EXPECTED);
  });
});

describe("sweepExpiredSessions", () => {
  it("expires at the exact expiresAt instant, not strictly after (010 convention)", async () => {
    const { formId, version } = await seedForm("frm_sweep_boundary");
    const now = new Date("2026-03-01T00:00:00.000Z");

    const atBoundary = SessionId.parse("ses_sweep_at");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: atBoundary,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: now, // exactly equal → expired
    });
    const justAfter = SessionId.parse("ses_sweep_after");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: justAfter,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(now.getTime() + 1), // 1ms in the future → still valid
    });

    const result = await sweepExpiredSessions(testDb.db, now);
    const swept = result.expired.map((r) => r.sessionId);
    expect(swept).toContain(atBoundary);
    expect(swept).not.toContain(justAfter);
    expect((await getSession(testDb.db, atBoundary))?.status).toBe("expired");
    expect((await getSession(testDb.db, justAfter))?.status).toBe("created");
  });

  it("never expires a submitted session and is idempotent on re-run", async () => {
    const { formId, version } = await seedForm("frm_sweep_submit");
    const now = new Date("2026-04-01T00:00:00.000Z");

    // A submitted session whose expiry is in the past - must stay submitted.
    const submitted = SessionId.parse("ses_sweep_submitted");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: submitted,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(now.getTime() - 10_000),
    });
    await markSubmitted(testDb.db, submitted);

    const abandoned = SessionId.parse("ses_sweep_abandoned");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: abandoned,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(now.getTime() - 10_000),
    });

    const first = await sweepExpiredSessions(testDb.db, now);
    const firstIds = first.expired.map((r) => r.sessionId);
    expect(firstIds).toContain(abandoned);
    expect(firstIds).not.toContain(submitted);
    expect((await getSession(testDb.db, submitted))?.status).toBe("submitted");

    // Idempotent: the second run over the same clock re-expires nothing of ours.
    const second = await sweepExpiredSessions(testDb.db, now);
    const secondIds = second.expired.map((r) => r.sessionId);
    expect(secondIds).not.toContain(abandoned);
    expect(secondIds).not.toContain(submitted);
  });
});

describe("purgeExpired", () => {
  it("removes expired-never-submitted sessions (and their answers) only", async () => {
    const { formId, version } = await seedForm("frm_purge");
    const horizon = new Date("2026-05-10T00:00:00.000Z");

    // (a) expired, never submitted, older than horizon, with answers → purged.
    const purgeable = SessionId.parse("ses_purge_old");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: purgeable,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    await appendAnswer(testDb.db, {
      sessionId: purgeable,
      questionId: QuestionId.parse("q_partial"),
      value: "wip",
    });

    // (b) expired, but exactly at the horizon → retained (strictly-before).
    const atHorizon = SessionId.parse("ses_purge_athorizon");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: atHorizon,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: horizon,
    });

    // (c) submitted (status) with past expiry → never purged.
    const submitted = SessionId.parse("ses_purge_submitted");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: submitted,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    await markSubmitted(testDb.db, submitted);
    await insertSubmission(testDb.db, {
      sessionId: submitted,
      contentHash: "0".repeat(64),
      lockedAnswers: lockedSubmission([{ questionId: "q_text", value: "keep" }]),
    });

    // Sweep (a) and (b) to `expired` first (past `now`).
    await sweepExpiredSessions(testDb.db, new Date("2026-05-11T00:00:00.000Z"));
    expect((await getSession(testDb.db, purgeable))?.status).toBe("expired");
    expect((await getSession(testDb.db, atHorizon))?.status).toBe("expired");

    const result = await purgeExpired(testDb.db, horizon);
    const purged = result.purgedSessionIds;

    expect(purged).toContain(purgeable);
    expect(purged).not.toContain(atHorizon);
    expect(purged).not.toContain(submitted);

    // (a) fully gone: session row and its answers.
    expect(await getSession(testDb.db, purgeable)).toBeUndefined();
    const leftoverAnswers = await testDb.client.query(
      `select 1 from answers where session_id = $1`,
      [purgeable],
    );
    expect(leftoverAnswers.rowCount).toBe(0);

    // (b) and (c) survive.
    expect((await getSession(testDb.db, atHorizon))?.status).toBe("expired");
    expect((await getSession(testDb.db, submitted))?.status).toBe("submitted");
  });

  it("does not purge an expired session that carries a submission (anti-join)", async () => {
    const { formId, version } = await seedForm("frm_purge_edge");
    const edge = SessionId.parse("ses_purge_edge");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: edge,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    // Force the pathological state: expired status but a submission row present.
    await insertSubmission(testDb.db, {
      sessionId: edge,
      contentHash: "0".repeat(64),
      lockedAnswers: lockedSubmission([{ questionId: "q_text", value: "audit" }]),
    });
    await sweepExpiredSessions(testDb.db, new Date("2026-06-02T00:00:00.000Z"));
    expect((await getSession(testDb.db, edge))?.status).toBe("expired");

    const result = await purgeExpired(testDb.db, new Date("2026-07-01T00:00:00.000Z"));
    expect(result.purgedSessionIds).not.toContain(edge);
    expect(await getSession(testDb.db, edge)).toBeDefined();
  });
});
