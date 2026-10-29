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
  stepQuestionRefs,
} from "@roonga/qcms-core";
import {
  answers,
  createForm,
  ensureSeedWorkspace,
  createQuestion,
  createQuestionVersion,
  deprecateQuestionVersion,
  formDrafts,
  formVersions,
  forms,
  getForm,
  getQuestion,
  getQuestionVersion,
  insertFormVersion,
  listFormVersions,
  listQuestionVersions,
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

// A development tool only: it writes domain tables directly, which no app may do, and is
// kept out of the deployed artifact by `files: ["dist"]`.

// Resolves in a checkout and under `/app/seed` alike.
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

export const FORM_SLUG = "sample-library";

const SEMANTICS_VERSION = "1";

export type Db = NodePgDatabase<typeof schema>;

interface Fixture {
  readonly file: string;
  readonly definition: QuestionDefinition;
}

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, "utf8"));
}

// Parsed through the kernel rather than inserted raw, so the schema defaults the compiler
// reads are applied.
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

function readFormFixture(): { definition: FormDefinition; compiled: CompiledForm } {
  const parsed = parseFormDefinition(readJson(FORM_DEFINITION_FIXTURE));
  if (!parsed.ok) {
    throw new Error("apps/api/scripts/fixtures/sample-library-form.json is not a valid form");
  }
  // Stored verbatim rather than validated here: `e2e/support/fixture-drift.test.ts`
  // recompiles it on every `pnpm verify`, so the seed image needs no compiler.
  const compiled = readJson(FORM_COMPILED_FIXTURE) as CompiledForm;
  return { definition: parsed.value, compiled };
}

function slugOf(questionId: string): string {
  return questionId.replace(/^q_/, "").replaceAll("_", "-");
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

// A cap rather than a per-question count, because how many versions a question got
// depends on where its fixture fell in the run that wrote it, which nothing records.
const MAX_SEEDED_VERSIONS = 2;

// Key-sorted, because `jsonb` normalises key order on the way in: a stored definition and
// the fixture it came from differ as strings while describing the same document.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  // ASCII code-unit order, not `localeCompare`: a canonical form has to be the same on
  // every machine, and `localeCompare` is locale-dependent.
  const byKey = (left: readonly [string, unknown], right: readonly [string, unknown]): number => {
    if (left[0] === right[0]) return 0;
    return left[0] < right[0] ? -1 : 1;
  };
  const members = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(byKey)
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
  return `{${members.join(",")}}`;
}

// Each question is published before the form, because the publish path refuses a form
// pinning an unpublished version.
async function seedQuestions(
  db: Db,
  fixtures: readonly Fixture[],
  workspaceId: string,
): Promise<Fixture[]> {
  const created: Fixture[] = [];
  let skipped = 0;

  for (const fixture of fixtures) {
    const { questionId } = fixture.definition;
    if ((await getQuestion(db, questionId)) !== undefined) {
      skipped += 1;
      continue;
    }
    await createQuestion(db, { questionId, slug: slugOf(questionId), workspaceId });
    await createQuestionVersion(db, { questionId, definition: fixture.definition });
    await publishQuestionVersion(db, { questionId, version: 1 });
    created.push(fixture);
  }

  say(`Seeded ${String(created.length)} question(s); ${String(skipped)} already present.`);
  return created;
}

// Only the questions THIS run created, so nothing is added to a library an operator has
// since been working in. Runs after the form is published, because neither a deprecated
// nor an unpublished pin is publishable.
async function arrangeQuestionStates(db: Db, created: readonly Fixture[]): Promise<void> {
  for (const [index, fixture] of created.entries()) {
    const { questionId } = fixture.definition;
    if (index === 0) continue;
    if (index === created.length - 1) {
      await deprecateQuestionVersion(db, { questionId, version: 1 });
      continue;
    }
    await createQuestionVersion(db, { questionId, definition: fixture.definition });
  }
}

// `insertFormVersion` is a storage door and validates no pin, so the check the real
// publish path makes has to be made here.
async function unpublishablePins(db: Db, definition: FormDefinition): Promise<string[]> {
  const byId = new Map(
    readQuestionFixtures().map((fixture) => [
      String(fixture.definition.questionId),
      canonicalJson(fixture.definition),
    ]),
  );
  const reasons: string[] = [];

  for (const step of definition.steps) {
    for (const item of stepQuestionRefs(step)) {
      const pin = `${String(item.questionId)}@${String(item.version)}`;
      const row = await getQuestionVersion(db, item.questionId, item.version);
      if (row === undefined) {
        reasons.push(`${pin} does not exist`);
        continue;
      }
      if (row.status === "draft") {
        reasons.push(`${pin} is a draft, and a published form may not pin an unpublished version`);
        continue;
      }
      if (canonicalJson(row.definition) !== byId.get(String(item.questionId))) {
        reasons.push(`${pin} holds content this seed did not write`);
      }
    }
  }
  return reasons;
}

export function publishRefusalMessage(formId: string, reasons: readonly string[]): string {
  return [
    `Refusing to publish ${formId}: ${String(reasons.length)} pinned question version(s) are not this seed's.`,
    "",
    ...reasons.map((reason) => `  - ${reason}`),
    "",
    "The sample questions were loaded and are untouched. The form was NOT published, because",
    "its committed snapshot describes the fixture corpus: publishing it over somebody else's",
    "content would serve a document that does not match what the library holds, and over a",
    "draft it would store the state the real publish path rejects as UNPUBLISHED_QUESTION_PIN.",
    "",
    "Rename or remove the conflicting question(s), or start from a stack with none of them:",
    "",
    "  pnpm dev:down && pnpm dev:up && pnpm dev:seed",
  ].join("\n");
}

export class PublishRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishRefused";
  }
}

// Returns the refusal rather than throwing, because `seed` still has the library states to
// arrange and a run that stops half way leaves a stack no re-run repairs.
async function seedForm(db: Db, workspaceId: string): Promise<string | undefined> {
  const { definition, compiled } = readFormFixture();
  const formId = definition.formId;

  const existing = await getForm(db, formId);
  if (existing !== undefined) {
    say(`Form ${formId} already present (slug "${existing.slug}"); published no new version.`);
    return undefined;
  }

  const reasons = await unpublishablePins(db, definition);
  if (reasons.length > 0) return publishRefusalMessage(String(formId), reasons);

  await createForm(db, {
    formId,
    slug: FORM_SLUG,
    workspaceId,
    defaultLocale: definition.defaultLocale,
  });
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
  return undefined;
}

export function seededIds(): { questionIds: QuestionId[]; formId: FormId } {
  return {
    questionIds: readQuestionFixtures().map((fixture) => fixture.definition.questionId),
    formId: readFormFixture().definition.formId,
  };
}

export interface Recognition {
  readonly id: string;
  readonly present: boolean;
  readonly mine: boolean;
  readonly why?: string;
}

// The derived set names corpus IDS, which are not a record of authorship, so what `clear`
// may remove is decided by content instead. The limit: a row byte-identical to what the
// seed writes is indistinguishable from one the seed wrote.
async function recogniseQuestion(db: Db, fixture: Fixture): Promise<Recognition> {
  const questionId = fixture.definition.questionId;
  const id = String(questionId);

  const row = await getQuestion(db, questionId);
  if (row === undefined) return { id, present: false, mine: false };
  if (row.slug !== slugOf(id)) {
    return { id, present: true, mine: false, why: `its slug is "${row.slug}", not the seed's` };
  }

  const versions = await listQuestionVersions(db, questionId);
  if (versions.length === 0 || versions.length > MAX_SEEDED_VERSIONS) {
    return {
      id,
      present: true,
      mine: false,
      why: `it has ${String(versions.length)} version(s); this seed writes at most ${String(MAX_SEEDED_VERSIONS)}`,
    };
  }
  const expected = canonicalJson(fixture.definition);
  const foreign = versions.find((version) => canonicalJson(version.definition) !== expected);
  if (foreign !== undefined) {
    return {
      id,
      present: true,
      mine: false,
      why: `version ${String(foreign.version)} is not the committed fixture's content`,
    };
  }
  return { id, present: true, mine: true };
}

// An open draft is deliberately not part of the test: it cannot outlive the form it
// belongs to, so it goes when the form goes, and the report says so.
async function recogniseForm(db: Db): Promise<Recognition> {
  const { definition } = readFormFixture();
  const id = String(definition.formId);

  const row = await getForm(db, definition.formId);
  if (row === undefined) return { id, present: false, mine: false };
  if (row.slug !== FORM_SLUG) {
    return { id, present: true, mine: false, why: `its slug is "${row.slug}", not the seed's` };
  }

  const versions = await listFormVersions(db, definition.formId);
  if (versions.length !== 1) {
    return {
      id,
      present: true,
      mine: false,
      why: `it has ${String(versions.length)} published version(s); this seed publishes exactly 1`,
    };
  }
  if (canonicalJson(versions[0]?.definition) !== canonicalJson(definition)) {
    return { id, present: true, mine: false, why: "version 1 is not the committed fixture's form" };
  }
  return { id, present: true, mine: true };
}

export interface Blocker {
  readonly what: string;
  readonly rows: number;
}

// The append-only answer ledger is why the refusal exists: once the seeded form has been
// answered there is no honest way for this script to take it away.
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

export class ClearRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClearRefused";
  }
}

export interface ClearOutcome {
  readonly questions: number;
  readonly versions: number;
  readonly forms: number;
  readonly formVersions: number;
  readonly draft: boolean;
  readonly removed: readonly string[];
  readonly left: readonly Recognition[];
}

export function clearReportLines(outcome: ClearOutcome): string[] {
  const lines = [
    `Cleared ${String(outcome.questions)} question(s) (${String(outcome.versions)} version(s)) ` +
      `and ${String(outcome.forms)} form(s) (${String(outcome.formVersions)} version(s))` +
      (outcome.draft ? ", plus the open draft on it, which cannot outlive the form" : "") +
      ".",
  ];
  if (outcome.removed.length > 0) lines.push(`  removed: ${outcome.removed.join(", ")}`);
  for (const entry of outcome.left) {
    lines.push(`  LEFT ALONE: ${entry.id} - ${entry.why ?? "not this seed's"}`);
  }
  lines.push(
    outcome.left.length > 0
      ? "Rows this seed did not write were left in place, including the ones named above."
      : "Rows this seed did not write were left in place.",
  );
  return lines;
}

export async function clear(db: Db): Promise<ClearOutcome> {
  const fixtures = readQuestionFixtures();
  const formId = readFormFixture().definition.formId;

  const blockers = await clearBlockers(db, formId);
  if (blockers.length > 0) throw new ClearRefused(refusalMessage(formId, blockers));

  const recognised = await Promise.all(
    fixtures.map(async (fixture) => recogniseQuestion(db, fixture)),
  );
  const form = await recogniseForm(db);
  const mine: QuestionId[] = fixtures
    .map((fixture) => fixture.definition.questionId)
    .filter((questionId) =>
      recognised.some((entry) => entry.id === String(questionId) && entry.mine),
    );
  const left = [...recognised, form].filter((entry) => entry.present && !entry.mine);

  let removedFormVersions = 0;
  let draft = false;
  if (form.mine) {
    draft =
      (await db.delete(formDrafts).where(eq(formDrafts.formId, formId)).returning()).length > 0;
    removedFormVersions = (
      await db.delete(formVersions).where(eq(formVersions.formId, formId)).returning()
    ).length;
    await db.delete(forms).where(eq(forms.formId, formId));
  }

  let questionRows = 0;
  let versionRows = 0;
  if (mine.length > 0) {
    versionRows = (
      await db
        .delete(questionVersions)
        .where(inArray(questionVersions.questionId, mine))
        .returning()
    ).length;
    questionRows = (
      await db.delete(questions).where(inArray(questions.questionId, mine)).returning()
    ).length;
  }

  const outcome: ClearOutcome = {
    questions: questionRows,
    versions: versionRows,
    forms: form.mine ? 1 : 0,
    formVersions: removedFormVersions,
    draft,
    removed: mine.map(String),
    left,
  };
  for (const line of clearReportLines(outcome)) say(line);
  return outcome;
}

// The states are arranged even when the form could not be published, because a second run
// would skip every question it created and never get back to the arranging.
export async function seed(db: Db): Promise<void> {
  // `pnpm dev:up` brings up a database with no accounts, so the workspace a form and a
  // question each need may not exist yet.
  const workspaceId = await ensureSeedWorkspace(db);
  const fixtures = readQuestionFixtures();
  const created = await seedQuestions(db, fixtures, workspaceId);
  const refusal = await seedForm(db, workspaceId);
  await arrangeQuestionStates(db, created);
  if (refusal !== undefined) throw new PublishRefused(refusal);
}

export async function reset(db: Db): Promise<void> {
  await clear(db);
  await seed(db);
}

const MODES = { seed, clear, reset };
type Mode = keyof typeof MODES;

// Defaults to `seed` so the container's own CMD stays argument-free.
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

// A refusal is an answer, not a crash, so it keeps no stack.
function describe(error: unknown): string {
  if (error instanceof ClearRefused || error instanceof PublishRefused) return error.message;
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

// Only when run as a command, so importing the exports above fires no seed.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`${describe(error)}\n`);
  }
}
