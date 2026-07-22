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

/** One appended answer row (append-only ledger). `value` is the stored JSONB. */
export interface AnswerRow {
  readonly questionId: string;
  readonly value: unknown;
  readonly answeredAt: string;
}

/** Open a connected client to the e2e database. Remember to `close()` it. */
export async function openDb(databaseUrl: string): Promise<Db> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return new Db(client);
}

export class Db {
  constructor(private readonly client: PgClient) {}

  /** Every appended answer row for a session, oldest first (append-only order). */
  async answerRows(sessionId: string): Promise<AnswerRow[]> {
    const result = await this.client.query<{
      question_id: string;
      value: unknown;
      answered_at: string;
    }>(
      `select question_id, value, answered_at
         from answers
        where session_id = $1
        order by answered_at asc, id asc`,
      [sessionId],
    );
    return result.rows.map((row) => ({
      questionId: row.question_id,
      value: row.value,
      answeredAt: row.answered_at,
    }));
  }

  /** The latest answer per question (DISTINCT ON, newest wins), as a map. */
  async latestAnswers(sessionId: string): Promise<Map<string, unknown>> {
    const result = await this.client.query<{ question_id: string; value: unknown }>(
      `select distinct on (question_id) question_id, value
         from answers
        where session_id = $1
        order by question_id, answered_at desc, id desc`,
      [sessionId],
    );
    return new Map(result.rows.map((row) => [row.question_id, row.value]));
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

  async close(): Promise<void> {
    await this.client.end();
  }
}
