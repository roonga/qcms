import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseQuestionDefinition } from "@roonga/qcms-core";
import {
  createQuestion,
  createQuestionVersion,
  deprecateQuestionVersion,
  getQuestion,
  publishQuestionVersion,
  schema,
} from "@roonga/qcms-db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

/**
 * `pnpm qcms:seed-fixtures` - load the sample question library into a development
 * database (task 032).
 *
 * The question library screens are only reviewable against content, and an empty library
 * hides every interesting state: a version timeline with more than one row, the three
 * status badges beside each other, a preview of each of the seven controls. This loads
 * the corpus the kernel already ships as fixtures (`packages/core/fixtures/questions`),
 * which is the same insurance-shaped content the golden corpus is built from, so the
 * screens are explored against realistic questions rather than "test 1", "test 2".
 *
 * ## Three properties, each deliberate
 *
 * **It goes through the kernel.** Every fixture is `parseQuestionDefinition`d before it is
 * written, never inserted raw. A raw insert skips the schema's `.prefault({})` defaults,
 * which produces rows that look fine in a table and then throw inside the compiler the
 * moment anything tries to render them - a trap this repo has already paid for once.
 *
 * **It is idempotent.** A question that already exists is left exactly as it is, because
 * an id is permanent (R6) and re-running a seed must never look like an attempt to reuse
 * one. Run it twice and the second run reports what it skipped.
 *
 * **It writes the database directly, and only this script may.** It is a development
 * tool, not part of any app: the admin is a strict BFF that never touches domain tables
 * (R2), so this lives in `apps/api`, which is the process that legitimately owns them.
 *
 * ## Statuses
 *
 * The first fixture is left a plain draft, the last is published and then deprecated, and
 * everything between is published with a second draft version opened on top. That is not
 * arbitrary: it is the smallest arrangement in which the list shows all three badges, the
 * detail screen has a multi-row timeline, and the "frozen version" and "deprecated
 * version" states both exist without anyone having to click through the lifecycle first.
 *
 * Usage:  DATABASE_URL=postgres://... pnpm qcms:seed-fixtures
 */

const FIXTURES = fileURLToPath(
  new URL("../../../packages/core/fixtures/questions/valid/", import.meta.url),
);

interface Fixture {
  readonly file: string;
  readonly definition: ReturnType<typeof parseQuestionDefinition>;
}

/** Read and kernel-parse every valid question fixture, sorted for a stable seed order. */
function readFixtures(): Fixture[] {
  return readdirSync(FIXTURES)
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => ({
      file,
      definition: parseQuestionDefinition(JSON.parse(readFileSync(`${FIXTURES}${file}`, "utf8"))),
    }));
}

/** The slug a fixture's question id implies (ids are `q_` plus underscored words). */
function slugOf(questionId: string): string {
  return questionId.replace(/^q_/, "").replaceAll("_", "-");
}

async function seed(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is not set. Point it at a DEVELOPMENT database.");
  }

  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    const fixtures = readFixtures();
    let created = 0;
    let skipped = 0;

    for (const [index, fixture] of fixtures.entries()) {
      const parsed = fixture.definition;
      if (!parsed.ok) {
        throw new Error(`${fixture.file} is not a valid question definition`);
      }
      const definition = parsed.value;
      const { questionId } = definition;

      if ((await getQuestion(db, questionId)) !== undefined) {
        skipped += 1;
        continue;
      }

      await createQuestion(db, { questionId, slug: slugOf(questionId) });
      await createQuestionVersion(db, { questionId, definition });

      // The first fixture stays a draft; everything else is published so the library has
      // pinnable content, and the last is then deprecated so that state exists too.
      const isFirst = index === 0;
      const isLast = index === fixtures.length - 1;
      if (!isFirst) {
        await publishQuestionVersion(db, { questionId, version: 1 });
        if (isLast) {
          await deprecateQuestionVersion(db, { questionId, version: 1 });
        } else {
          // A second draft on top of a published version: the state a version timeline
          // exists to make legible.
          await createQuestionVersion(db, { questionId, definition });
        }
      }
      created += 1;
    }

    process.stdout.write(
      `Seeded ${String(created)} question(s); ${String(skipped)} already present.\n`,
    );
  } finally {
    await pool.end();
  }
}

await seed();
