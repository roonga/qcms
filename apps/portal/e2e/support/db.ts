/**
 * Independent Postgres verification for the portal e2e (task 045, exit criterion
 * 4). The kitchen-sink spec opens its OWN connection to the e2e database (the URI
 * comes from the fixtures the harness wrote) and asserts what was persisted,
 * WITHOUT trusting the API's response echo: each stored answer in canonical form,
 * the append-only ledger (a changed answer adds a row, never mutates), and the
 * submission lock (`submittedAt` + `contentHash`).
 *
 * `pg` is not a portal dependency; it is a dependency of `qcms-api`, so we resolve
 * it from there exactly as `api-server.ts` resolves `@hono/node-server` - no new
 * dependency is added to the portal. A raw `pg` read returns `timestamptz` as a
 * STRING (not a Date), which is all these presence checks need.
 */

import { createRequire } from "node:module";

const apiRequire = createRequire(new URL("../../../api/package.json", import.meta.url));

interface QueryResult<R> {
  readonly rows: R[];
}
interface PgClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<R>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}
interface PgClientCtor {
  new (config: { connectionString: string }): PgClient;
}

const { Client } = apiRequire("pg") as { Client: PgClientCtor };

/**
 * One appended answer row (append-only ledger). `value` is the stored JSONB, and
 * `retracted` marks a tombstone row: the respondent cleared the question at this
 * point in the history (ADR-33), so `value` is null and the question resolves to
 * unanswered from here until it is answered again.
 */
export interface AnswerRow {
  readonly questionId: string;
  readonly value: unknown;
  readonly retracted: boolean;
  readonly answeredAt: string;
}

/** Open a connected client to the e2e database. Remember to `close()` it. */
export async function openDb(databaseUrl: string): Promise<Db> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return new Db(client);
}

/** One appended answer row, with the instance it belongs to (task 073). */
export interface InstanceAnswerRow {
  readonly questionId: string;
  /** Null for a question outside every repeating group. */
  readonly instanceId: string | null;
  readonly value: unknown;
  readonly retracted: boolean;
}

/** One entry of a sealed submission's answer set (task 073). */
export interface LockedAnswerRow {
  readonly questionId: string;
  readonly instanceId?: string;
  readonly value: unknown;
}

/** One row of the append-only roster ledger (task 072). */
export interface RosterRow {
  readonly groupId: string;
  readonly instanceId: string;
  readonly event: string;
}

export class Db {
  constructor(private readonly client: PgClient) {}

  /** Every appended answer row for a session, oldest first (append-only order). */
  async answerRows(sessionId: string): Promise<AnswerRow[]> {
    const result = await this.client.query<{
      question_id: string;
      value: unknown;
      retracted: boolean;
      answered_at: string;
    }>(
      `select question_id, value, retracted, answered_at
         from answers
        where session_id = $1
        order by answered_at asc, id asc`,
      [sessionId],
    );
    return result.rows.map((row) => ({
      questionId: row.question_id,
      value: row.value,
      retracted: row.retracted,
      answeredAt: row.answered_at,
    }));
  }

  /**
   * The latest answer per question (DISTINCT ON, newest wins), as a map. A
   * question whose newest row is a retraction is omitted entirely, mirroring
   * `latestAnswers` in `@roonga/qcms-db` (ADR-33): the filter runs AFTER the pick, since
   * excluding retractions from it would resurrect the cleared answer.
   */
  async latestAnswers(sessionId: string): Promise<Map<string, unknown>> {
    const result = await this.client.query<{
      question_id: string;
      value: unknown;
      retracted: boolean;
    }>(
      `select distinct on (question_id) question_id, value, retracted
         from answers
        where session_id = $1
        order by question_id, answered_at desc, id desc`,
      [sessionId],
    );
    return new Map(
      result.rows.filter((row) => !row.retracted).map((row) => [row.question_id, row.value]),
    );
  }

  /** How many rows a given question has (append-only proof: a change adds a row). */
  async answerCount(sessionId: string, questionId: string): Promise<number> {
    const result = await this.client.query<{ n: string }>(
      `select count(*)::text as n from answers where session_id = $1 and question_id = $2`,
      [sessionId, questionId],
    );
    return Number(result.rows[0]?.n ?? "0");
  }

  /** The submission lock row (submittedAt + contentHash), or null if unsubmitted. */
  async submission(
    sessionId: string,
  ): Promise<{ contentHash: string; submittedAt: string } | null> {
    const result = await this.client.query<{ content_hash: string; submitted_at: string }>(
      `select content_hash, submitted_at from submissions where session_id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { contentHash: row.content_hash, submittedAt: row.submitted_at };
  }

  /**
   * Every appended answer row **with its instance**, oldest first (task 073).
   *
   * A second reader beside {@link answerRows} rather than a widening of it, because the
   * existing one is what half a dozen specs assert against and a repeated answer is a
   * new grain: the ledger's key is `(question_id, instance_id)` since migration 0022,
   * and `instance_id` is null for every question outside a repeating group.
   */
  async instanceAnswerRows(sessionId: string): Promise<InstanceAnswerRow[]> {
    const result = await this.client.query<{
      question_id: string;
      instance_id: string | null;
      value: unknown;
      retracted: boolean;
    }>(
      `select question_id, instance_id, value, retracted
         from answers
        where session_id = $1
        order by answered_at asc, id asc`,
      [sessionId],
    );
    return result.rows.map((row) => ({
      questionId: row.question_id,
      instanceId: row.instance_id,
      value: row.value,
      retracted: row.retracted,
    }));
  }

  /**
   * The sealed answer set, as the submission stored it (task 073).
   *
   * This is what a repeat walk has to be judged against rather than the ledger: the
   * ledger keeps a removed instance's answers forever and the locked set excludes them,
   * exactly as it excludes a hidden question's (I6, ADR-42). Asserting one without the
   * other would miss whichever half the code got wrong.
   */
  async lockedAnswers(sessionId: string): Promise<LockedAnswerRow[]> {
    const result = await this.client.query<{
      locked_answers: { answers: LockedAnswerRow[] };
    }>(`select locked_answers from submissions where session_id = $1`, [sessionId]);
    return result.rows[0]?.locked_answers.answers ?? [];
  }

  /**
   * The roster ledger for a session, oldest first: what was minted and what a
   * respondent removed (task 072's `answer_group_instances`).
   *
   * Append-only, so a removal is a row rather than the absence of one. A spec reads it
   * to prove that a removed instance was never deleted.
   */
  async rosterRows(sessionId: string): Promise<RosterRow[]> {
    const result = await this.client.query<{
      group_id: string;
      instance_id: string;
      event: string;
    }>(
      `select group_id, instance_id, event
         from answer_group_instances
        where session_id = $1
        order by occurred_at asc, instance_id asc`,
      [sessionId],
    );
    return result.rows.map((row) => ({
      groupId: row.group_id,
      instanceId: row.instance_id,
      event: row.event,
    }));
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
