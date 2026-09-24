import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import {
  parseFormDefinition,
  parseQuestionDefinition,
  type FormDefinition,
  type FormId,
  type QuestionDefinition,
  type QuestionId,
} from "@roonga/qcms-core";
import {
  answers,
  createForm,
  createQuestion,
  createQuestionVersion,
  deprecateQuestionVersion,
  formDrafts,
  formVersions,
  forms,
  getForm,
  getQuestion,
  insertFormVersion,
  publishQuestionVersion,
  questionVersions,
  questions,
  schema,
  secureLinks,
  sessions,
  submissions,
  webhooks,
} from "@roonga/qcms-db";
import { count, eq, inArray } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

/**
 * `pnpm dev:seed`, `pnpm dev:seed:clear`, `pnpm dev:seed:reset` - the sample data a
 * development database needs to be worth opening (task 032, issue #994).
 *
 * The library screens are only reviewable against content, and an empty library hides
 * every interesting state: a version timeline with more than one row, the three status
 * badges beside each other, a preview of each of the seven controls. The portal has the
 * same problem one level up - a stack with questions and no published form has nothing a
 * respondent can open at all, which is what `pnpm dev:up` used to leave behind.
 *
 * So this loads two things: the question corpus the kernel already ships as fixtures
 * (`packages/core/fixtures/questions/valid`), and ONE published form over every question
 * in it (`apps/api/scripts/fixtures/sample-library-form.json`).
 *
 * ## Four properties, each deliberate
 *
 * **It goes through the kernel.** Every fixture is `parseQuestionDefinition`d or
 * `parseFormDefinition`d before it is written, never inserted raw. A raw insert skips the
 * schema's `.prefault({})` defaults, which produces rows that look fine in a table and
 * then throw inside the compiler the moment anything tries to render them - a trap this
 * repository has already paid for once.
 *
 * **It publishes the form the way the dev launcher does.** `createForm` then
 * `insertFormVersion` storing the COMMITTED compiled A2UI document verbatim, exactly as
 * `scripts/dev-stack.mjs` seeds the kitchen sink. ADR-18: a published document is served
 * byte for byte and never recompiled, so the bytes a developer answers here are the bytes
 * a gate checks. `apps/api/e2e/support/fixture-drift.test.ts` recompiles
 * `sample-library.a2ui.json` through the real publish path on every `pnpm verify` and
 * fails on divergence, which is what lets this script store bytes instead of shipping a
 * compiler into the seed image.
 *
 * **It is idempotent.** A question or a form that already exists is left exactly as it is,
 * because an id is permanent (R6) and re-running a seed must never look like an attempt to
 * reuse one. Run it twice and the second run reports what it skipped and publishes no
 * second form version.
 *
 * **It writes the database directly, and only this script may.** It is a development tool,
 * not part of any app: the admin is a strict BFF that never touches domain tables (R2), so
 * this lives in `apps/api`, which is the process that legitimately owns them. It stays out
 * of the deployed artifact - `apps/api/package.json` ships `files: ["dist"]`, and
 * `docker/seed.Dockerfile` copies this file into a separate toolbox image.
 *
 * ## The order the seed writes in, and why it is not the obvious one
 *
 * Every question gets a PUBLISHED version 1 first, then the form is published over those
 * pins, and only then are the interesting library states arranged on top. That order is
 * forced by the domain rather than chosen: the publish path refuses a form that pins an
 * unpublished version (`UNPUBLISHED_QUESTION_PIN`) or that newly pins a deprecated one
 * (`DEPRECATED_PIN`, `apps/api/src/features/forms/handler.ts`), so a library arranged
 * first has no valid form over all of it.
 *
 * The arrangement afterwards: the first fixture keeps its published version and nothing
 * else, the last is deprecated, and everything between gets a second draft version opened
 * on top. That is the smallest arrangement in which the list shows all three badges -
 * `listQuestions` summarises a question by its HIGHEST version's status, so published,
 * draft and deprecated each need a question whose top version is in that state - and in
 * which the detail screen has a multi-row timeline and the "frozen version" and
 * "deprecated version" states both exist without anyone clicking through the lifecycle.
 * Before issue #994 the first fixture was a bare draft and no question summarised as
 * `published` at all, so one of the three badges this arrangement claims was unreachable.
 *
 * The deprecation lands on a version the published form pins, which is realistic rather
 * than awkward: a frozen snapshot is self-contained (ADR-18) and keeps serving, and the
 * admin's deprecated-pin gate permits the pin to be carried into the next draft precisely
 * because it was already in the previous published version.
 *
 * ## Telling its own rows apart
 *
 * `clear` removes what this seed wrote and nothing else, and the set it removes is DERIVED
 * from the same committed fixtures the seed writes from: the question ids in
 * `packages/core/fixtures/questions/valid` and the `formId` in the committed form
 * definition. No manifest table and no id prefix.
 *
 * A recorded manifest was the alternative and is worse here on every axis that matters. It
 * needs a table, which means a migration in the PUBLISHED `@roonga/qcms-db` schema - a row
 * in every adopter's production database to support a development-only script. It can go
 * stale against the corpus, which a derived set cannot. And it would have to survive its
 * own `clear` for `reset` to restore the same ids, which is the one property R6 makes
 * non-negotiable: a reseeded question comes back under the id it had, and deriving the set
 * from the fixtures guarantees that by construction.
 *
 * What a derived set cannot distinguish is a row somebody hand-authored under a seeded id.
 * R6 already forbids that (an id is never reused with a different meaning), and `clear`
 * prints every id it removed, so the case is visible rather than silent.
 *
 * ## What `clear` refuses to do
 *
 * The answer ledger is append-only and immutable by trigger: `answers_reject_delete`
 * (migration 0004) rejects every DELETE outside the two sanctioned erasure and retention
 * doors, and `sessions_form_version_fk` means a session pinned to the seeded form holds
 * the version it pins. So once anybody has answered the seeded form, there is no honest
 * way for this script to take the form away.
 *
 * It therefore REFUSES rather than half-clearing: it counts the sessions, answers and
 * submissions that reference the seeded form, names them, and points at
 * `pnpm dev:down && pnpm dev:up`, which drops the stack's volume and is the only command
 * that removes respondent data from a development stack. Secure links and webhooks
 * authored against the seeded form block it the same way and for the same reason - they
 * are hand-authored rows, and this script deletes none of those. Nothing here weakens a
 * trigger or opens the erasure guard.
 *
 * Usage:
 *
 *   DATABASE_URL=postgres://... node apps/api/scripts/seed-fixtures.ts [seed|clear|reset]
 *
 * and, against the composed stack, `pnpm dev:seed`, `pnpm dev:seed:clear` and
 * `pnpm dev:seed:reset`, which run this inside the stack's own network
 * (`scripts/compose-seed.mjs`).
 */

/** Repository root as this file sees it, in a checkout and under `/app/seed` alike. */
const REPOSITORY = new URL("../../../", import.meta.url);

const QUESTION_FIXTURES = new URL("packages/core/fixtures/questions/valid/", REPOSITORY);
const FORM_DEFINITION_FIXTURE = new URL(
  "apps/api/scripts/fixtures/sample-library-form.json",
  REPOSITORY,
);
const FORM_COMPILED_FIXTURE = new URL(
  "apps/api/scripts/fixtures/sample-library.a2ui.json",
  REPOSITORY,
);

/** The seeded form's human-facing slug: the portal URL is `/f/<slug>`. */
export const FORM_SLUG = "sample-library";

/** The evaluation-semantics stamp every snapshot in this repository carries (ADR-16). */
const SEMANTICS_VERSION = "1";

/** A drizzle handle over the full schema - what every exported function below takes. */
export type Db = NodePgDatabase<typeof schema>;

interface Fixture {
  readonly file: string;
  readonly definition: QuestionDefinition;
}

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, "utf8"));
}

/** Read and kernel-parse every valid question fixture, sorted for a stable seed order. */
function readQuestionFixtures(): Fixture[] {
  return readdirSync(QUESTION_FIXTURES)
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => {
      const parsed = parseQuestionDefinition(readJson(new URL(file, QUESTION_FIXTURES)));
      if (!parsed.ok) throw new Error(`${file} is not a valid question definition`);
      return { file, definition: parsed.value };
    });
}

/** Read and kernel-parse the committed form definition this seed publishes. */
function readFormFixture(): { definition: FormDefinition; compiled: CompiledForm } {
  const parsed = parseFormDefinition(readJson(FORM_DEFINITION_FIXTURE));
  if (!parsed.ok) {
    throw new Error("apps/api/scripts/fixtures/sample-library-form.json is not a valid form");
  }
  // A committed compiled document, recompiled and asserted byte-for-byte by
  // `apps/api/e2e/support/fixture-drift.test.ts` on every `pnpm verify`. Re-validating it
  // here would mean shipping the A2UI spec validator into the seed image for a property a
  // gate already holds.
  const compiled = readJson(FORM_COMPILED_FIXTURE) as CompiledForm;
  return { definition: parsed.value, compiled };
}

/** The slug a fixture's question id implies (ids are `q_` plus underscored words). */
function slugOf(questionId: string): string {
  return questionId.replace(/^q_/, "").replaceAll("_", "-");
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Create every fixture question, each with a published version 1.
 *
 * Published, and published BEFORE the form: see the ordering note in the module
 * docstring. The interesting library states are arranged afterwards by
 * {@link arrangeQuestionStates}, over questions that already carry a publishable pin.
 */
async function seedQuestions(db: Db, fixtures: readonly Fixture[]): Promise<Fixture[]> {
  const created: Fixture[] = [];
  let skipped = 0;

  for (const fixture of fixtures) {
    const { questionId } = fixture.definition;
    if ((await getQuestion(db, questionId)) !== undefined) {
      skipped += 1;
      continue;
    }
    await createQuestion(db, { questionId, slug: slugOf(questionId) });
    await createQuestionVersion(db, { questionId, definition: fixture.definition });
    await publishQuestionVersion(db, { questionId, version: 1 });
    created.push(fixture);
  }

  say(`Seeded ${String(created.length)} question(s); ${String(skipped)} already present.`);
  return created;
}

/**
 * Arrange the library states this seed exists to make visible, on the questions THIS run
 * created - never on one it skipped, which would add a version to a library an operator
 * has since been working in.
 *
 * First keeps its published version alone, last is deprecated, the rest get a draft on
 * top. Runs after the form is published, because neither a deprecated nor an unpublished
 * pin is publishable.
 */
async function arrangeQuestionStates(db: Db, created: readonly Fixture[]): Promise<void> {
  for (const [index, fixture] of created.entries()) {
    const { questionId } = fixture.definition;
    if (index === 0) continue;
    if (index === created.length - 1) {
      await deprecateQuestionVersion(db, { questionId, version: 1 });
      continue;
    }
    // A second draft on top of a published version: the state a version timeline exists
    // to make legible.
    await createQuestionVersion(db, { questionId, definition: fixture.definition });
  }
}

/**
 * Publish the sample form over the seeded library, once.
 *
 * `getForm` is the idempotence check rather than a version count: the form identity is
 * what a re-run must not duplicate, and a form that exists already carries the version
 * this seed would publish. Never a second version - republishing identical bytes grows a
 * timeline that says a change happened when none did.
 */
async function seedForm(db: Db): Promise<void> {
  const { definition, compiled } = readFormFixture();
  const formId = definition.formId;

  const existing = await getForm(db, formId);
  if (existing !== undefined) {
    say(`Form ${formId} already present (slug "${existing.slug}"); published no new version.`);
    return;
  }

  await createForm(db, { formId, slug: FORM_SLUG, defaultLocale: definition.defaultLocale });
  const version = await insertFormVersion(db, {
    formId,
    definition,
    compiled,
    compilerVersion: compiled.compilerVersion,
    a2uiSpecVersion: compiled.a2uiSpecVersion,
    semanticsVersion: SEMANTICS_VERSION,
  });

  const pins = definition.steps.reduce((total, step) => total + step.items.length, 0);
  say(
    `Published ${formId} v${String(version.version)} as slug "${FORM_SLUG}" ` +
      `(${String(definition.steps.length)} steps, ${String(pins)} pinned questions, ` +
      `${String(definition.rules.length)} rules). Open it at /f/${FORM_SLUG}.`,
  );
}

/** Everything this seed writes, derived from the committed fixtures it writes from. */
export function seededIds(): { questionIds: QuestionId[]; formId: FormId } {
  return {
    questionIds: readQuestionFixtures().map((fixture) => fixture.definition.questionId),
    formId: readFormFixture().definition.formId,
  };
}

/** One reason `clear` will not remove the seeded form, and how many rows say so. */
export interface Blocker {
  readonly what: string;
  readonly rows: number;
}

/**
 * What references the seeded form and is not this seed's to remove.
 *
 * Answers and submissions are counted alongside their sessions because those are the rows
 * a developer will be asking about: the append-only ledger is the reason the refusal
 * exists at all.
 */
export async function clearBlockers(db: Db, formId: FormId): Promise<Blocker[]> {
  const [sessionRows] = await db
    .select({ n: count() })
    .from(sessions)
    .where(eq(sessions.formId, formId));
  const [answerRows] = await db
    .select({ n: count() })
    .from(answers)
    .innerJoin(sessions, eq(answers.sessionId, sessions.sessionId))
    .where(eq(sessions.formId, formId));
  const [submissionRows] = await db
    .select({ n: count() })
    .from(submissions)
    .innerJoin(sessions, eq(submissions.sessionId, sessions.sessionId))
    .where(eq(sessions.formId, formId));
  const [linkRows] = await db
    .select({ n: count() })
    .from(secureLinks)
    .where(eq(secureLinks.formId, formId));
  const [webhookRows] = await db
    .select({ n: count() })
    .from(webhooks)
    .where(eq(webhooks.formId, formId));

  return (
    [
      { what: "respondent session(s)", rows: sessionRows?.n ?? 0 },
      { what: "answer ledger row(s)", rows: answerRows?.n ?? 0 },
      { what: "submission(s)", rows: submissionRows?.n ?? 0 },
      { what: "secure link(s)", rows: linkRows?.n ?? 0 },
      { what: "webhook(s)", rows: webhookRows?.n ?? 0 },
    ] satisfies Blocker[]
  ).filter((blocker) => blocker.rows > 0);
}

/** The refusal text, pure so `seed-fixtures.test.ts` asserts what a developer reads. */
export function refusalMessage(formId: string, blockers: readonly Blocker[]): string {
  return [
    `Refusing to clear: ${formId} is referenced by rows this seed did not create.`,
    "",
    ...blockers.map((blocker) => `  - ${String(blocker.rows)} ${blocker.what}`),
    "",
    "The answer ledger is append-only and immutable by trigger (migration 0004): DELETE on",
    "answers is rejected outside the sanctioned erasure and retention doors, and a session",
    "holds the form version it is pinned to by foreign key. So the seeded form cannot be",
    "removed once it has been answered, and clearing the rest around it would leave a stack",
    "in a state no code path produces.",
    "",
    "NOTHING WAS DELETED. For a stack with no respondent data, drop this one and start again:",
    "",
    "  pnpm dev:down && pnpm dev:up && pnpm dev:seed",
  ].join("\n");
}

/** A clear that could not proceed. Reported as its own message, with no stack trace. */
export class ClearRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClearRefused";
  }
}

/**
 * Remove exactly what the seed wrote: its questions and their versions, its form, the
 * form's versions, and the draft the form may be carrying.
 *
 * The draft is the one row here an operator may have authored, and it goes with the form
 * because it cannot outlive it (`form_drafts.form_id` references `forms`). It is a working
 * copy of a seeded form and the next seed restores what it was a copy of, so this is
 * stated rather than silent: the report names it when there was one.
 */
export async function clear(db: Db): Promise<void> {
  const { questionIds, formId } = seededIds();

  const blockers = await clearBlockers(db, formId);
  if (blockers.length > 0) throw new ClearRefused(refusalMessage(formId, blockers));

  const drafts = await db.delete(formDrafts).where(eq(formDrafts.formId, formId)).returning();
  const versions = await db.delete(formVersions).where(eq(formVersions.formId, formId)).returning();
  const clearedForms = await db.delete(forms).where(eq(forms.formId, formId)).returning();
  const clearedVersions = await db
    .delete(questionVersions)
    .where(inArray(questionVersions.questionId, questionIds))
    .returning();
  const clearedQuestions = await db
    .delete(questions)
    .where(inArray(questions.questionId, questionIds))
    .returning();

  say(
    `Cleared ${String(clearedQuestions.length)} seeded question(s) ` +
      `(${String(clearedVersions.length)} version(s)) and ` +
      `${String(clearedForms.length)} seeded form(s) (${String(versions.length)} version(s)` +
      `${drafts.length > 0 ? ", plus the open draft on it" : ""}).`,
  );
  if (clearedQuestions.length > 0) {
    const removed: QuestionId[] = clearedQuestions.map(
      (row: { questionId: QuestionId }) => row.questionId,
    );
    say(`  questions: ${removed.join(", ")}`);
  }
  say("Nothing else was touched: hand-authored questions and forms are still there.");
}

/** Load the sample library and publish the sample form (`pnpm dev:seed`). */
export async function seed(db: Db): Promise<void> {
  const fixtures = readQuestionFixtures();
  const created = await seedQuestions(db, fixtures);
  await seedForm(db);
  await arrangeQuestionStates(db, created);
}

/** `clear` then `seed`: every question comes back under the id it had (R6). */
export async function reset(db: Db): Promise<void> {
  await clear(db);
  await seed(db);
}

const MODES = { seed, clear, reset };
type Mode = keyof typeof MODES;

/** The subcommand, defaulting to `seed` so the container's own CMD stays argument-free. */
export function parseMode(argv: readonly string[]): Mode {
  const requested = argv[2] ?? "seed";
  if (requested === "seed" || requested === "clear" || requested === "reset") return requested;
  throw new Error(`Unknown mode "${requested}". Usage: seed-fixtures.ts [seed|clear|reset]`);
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv);
  const connectionString = process.env["DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is not set. Point it at a DEVELOPMENT database.");
  }

  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  try {
    await MODES[mode](db);
  } finally {
    await pool.end();
  }
}

/** What to print for a failure: a refusal is an answer, not a crash, so it keeps no stack. */
function describe(error: unknown): string {
  if (error instanceof ClearRefused) return error.message;
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

// Only when run as a command, so the exported functions above can be imported by
// `seed-fixtures.test.ts` without a seed firing on import. Same guard as
// `scripts/dev-compose.mjs` and `scripts/compose-e2e.mjs`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`${describe(error)}\n`);
  }
}
