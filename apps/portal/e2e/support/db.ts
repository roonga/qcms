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
  new (config: { connectionString: string; options?: string }): PgClient;
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

export async function openDb(databaseUrl: string): Promise<Db> {
  const client = new Client({
    connectionString: databaseUrl,
    options: "-c search_path=data_prod,control",
  });
  await client.connect();
  return new Db(client);
}

export interface InstanceAnswerRow {
  readonly questionId: string;
  /** Null for a question outside every repeating group. */
  readonly instanceId: string | null;
  readonly value: unknown;
  readonly retracted: boolean;
}

export interface LockedAnswerRow {
  readonly questionId: string;
  readonly instanceId?: string;
  readonly value: unknown;
}

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

  async lockedAnswers(sessionId: string): Promise<LockedAnswerRow[]> {
    const result = await this.client.query<{
      locked_answers: { answers: LockedAnswerRow[] };
    }>(`select locked_answers from submissions where session_id = $1`, [sessionId]);
    return result.rows[0]?.locked_answers.answers ?? [];
  }

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

  async expireSession(sessionId: string): Promise<void> {
    await this.client.query(`update sessions set status = 'expired' where session_id = $1`, [
      sessionId,
    ]);
  }

  /**
   * Mark a live session submitted behind the page's back, as another tab of the same
   * respondent would, so the API refuses its next request with `SESSION_SUBMITTED`
   * (local UX list P2). The status alone is what that refusal reads.
   */
  async markSessionSubmitted(sessionId: string): Promise<void> {
    await this.client.query(`update sessions set status = 'submitted' where session_id = $1`, [
      sessionId,
    ]);
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
