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
 * The derived set names IDS, though, and an id is not a record of authorship. That
 * difference was measured rather than argued about (issue #994 review): a question an
 * operator authored under a corpus id before seeding was deleted by `clear`, and so was an
 * operator's extra version on a seeded question. So the id set says what to LOOK at, and
 * {@link recogniseQuestion} decides what to remove, by content: a question whose slug is
 * the seed's and whose one or two versions carry the fixture's kernel-parsed bytes is this
 * seed's; anything else is left in place and named in the report. Same test for the form.
 *
 * The limit that remains is stated rather than hidden, here and in the output: a row
 * byte-identical to what the seed writes is indistinguishable from one the seed wrote, so
 * recreating a seeded question exactly and then clearing takes it. Nothing claims
 * otherwise - the closing line says rows this seed did not write were left in place, which
 * is the guarantee the recognition can actually deliver.
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
 * THE CODE OWNER RULED ON THIS (2026-09-25, issue #994): the refusal stays, and there is
 * no `--force` that would erase the sessions through the sanctioned door. A sample-data
 * script opening the GDPR erasure path on respondent rows is not a trade worth the thirty
 * seconds `pnpm dev:down && pnpm dev:up && pnpm dev:seed` costs, and that escape is
 * already in the refusal text. If a force is ever wanted it is its own issue with its own
 * security note, not a flag on this one.
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
 * The most versions this seed ever writes for one question: the published v1 and, for the
 * middle of the corpus, one draft on top ({@link arrangeQuestionStates}).
 *
 * A number rather than a per-question count because the per-question count depends on
 * where the fixture fell in the run that wrote it, which the database does not record. A
 * cap is the part that is true of every run, and it is enough to catch the case it exists
 * for: a version an operator opened on a seeded question.
 */
const MAX_SEEDED_VERSIONS = 2;

/**
 * A JSON value in key-sorted form, so two documents can be compared for content.
 *
 * Needed because the comparison crosses Postgres: `jsonb` normalises an object's key order
 * on the way in, so `JSON.stringify` of a stored definition and of the fixture it came
 * from differ as strings while describing the same document. Sorting both sides makes the
 * comparison about content, which is what {@link recogniseQuestion} is asking.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  // ASCII code-unit order, not `localeCompare`: a canonical form has to be the same on
  // every machine, and `localeCompare` is locale-dependent (the reason
  // `sonarjs/no-alphabetical-sort` is off workspace-wide).
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
 * Every pin in the committed form that this seed must not publish over, with the reason.
 *
 * `insertFormVersion` is a STORAGE door, not the publish path: it validates no pin, which
 * is right for a helper whose callers have already run `compileDraft`. This seed has not,
 * so the check the real publish path makes has to be made here, or a stack where a corpus
 * id was already taken by somebody else's question ends up with a published form whose
 * snapshot describes the corpus content while its pins resolve to theirs - and, if their
 * version is a draft, with the exact state `UNPUBLISHED_QUESTION_PIN` exists to prevent
 * (`apps/api/src/features/forms/handler.ts`).
 *
 * `deprecated` is accepted alongside `published` for the reason `deprecatedPinGate` gives:
 * a deprecated version is real, immutable, published-once content. It is also the state a
 * re-seed meets after an operator deletes the form by hand, since the corpus's last
 * question is deprecated by {@link arrangeQuestionStates}.
 */
async function unpublishablePins(db: Db, definition: FormDefinition): Promise<string[]> {
  const byId = new Map(
    readQuestionFixtures().map((fixture) => [
      String(fixture.definition.questionId),
      canonicalJson(fixture.definition),
    ]),
  );
  const reasons: string[] = [];

  for (const step of definition.steps) {
    for (const item of step.items) {
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

/** The text a refused publish prints, pure so the test asserts what a developer reads. */
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

/** A seed that loaded its questions and could not publish its form. */
export class PublishRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishRefused";
  }
}

/**
 * Publish the sample form over the seeded library, once.
 *
 * `getForm` is the idempotence check rather than a version count: the form identity is
 * what a re-run must not duplicate, and a form that exists already carries the version
 * this seed would publish. Never a second version - republishing identical bytes grows a
 * timeline that says a change happened when none did.
 *
 * Returns the refusal message when the pins are not this seed's, rather than throwing:
 * {@link seed} still has the library states to arrange, and a seed that stops half way
 * through leaves a stack no re-run repairs (a second run skips every question it already
 * created, so the arranging never happens).
 */
async function seedForm(db: Db): Promise<string | undefined> {
  const { definition, compiled } = readFormFixture();
  const formId = definition.formId;

  const existing = await getForm(db, formId);
  if (existing !== undefined) {
    say(`Form ${formId} already present (slug "${existing.slug}"); published no new version.`);
    return undefined;
  }

  const reasons = await unpublishablePins(db, definition);
  if (reasons.length > 0) return publishRefusalMessage(String(formId), reasons);

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
  return undefined;
}

/** Everything this seed writes, derived from the committed fixtures it writes from. */
export function seededIds(): { questionIds: QuestionId[]; formId: FormId } {
  return {
    questionIds: readQuestionFixtures().map((fixture) => fixture.definition.questionId),
    formId: readFormFixture().definition.formId,
  };
}

/** One id the derived set names, and whether the rows under it are this seed's to remove. */
export interface Recognition {
  readonly id: string;
  /** Rows exist under this id. */
  readonly present: boolean;
  /** Every row under it is one this seed writes, so `clear` may remove it. */
  readonly mine: boolean;
  /** When it is not this seed's, what differs. Named in the report, never guessed at. */
  readonly why?: string;
}

/**
 * Whether the rows under a fixture's id are the ones this seed wrote.
 *
 * THE POINT OF THIS FUNCTION is that the derived set is the fixture CORPUS, not a record
 * of authorship, and until issue #994's review those were treated as the same thing. They
 * are not, and the difference was measurable in two ways: an operator who authored a
 * question under a corpus id BEFORE seeding had it deleted by `clear` (the seed correctly
 * skipped it, then `clear` removed it anyway), and an operator's extra version on a seeded
 * question went with the question.
 *
 * Recognition by CONTENT closes both without a manifest table. What the seed writes is
 * fully determined by the committed fixtures - a question row whose slug is
 * `slugOf(questionId)`, with one or two versions whose definition is the fixture's
 * kernel-parsed bytes - so anything that does not match that shape is not something this
 * seed produced, whoever produced it, and `clear` leaves it and names it.
 *
 * The honest limit, stated rather than hidden: a row that is byte-identical to what the
 * seed writes is indistinguishable FROM what the seed writes. Recreate a seeded question
 * exactly and `clear` will take it. Everything the two measured cases covered differs in
 * content or in version count, so both are caught; an exact duplicate is not, and the
 * printed guarantee is worded to claim only what this can deliver.
 */
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

/**
 * Whether the seeded form's rows are this seed's, by the same content test.
 *
 * The open draft is deliberately NOT part of the test. A draft is a working copy of the
 * form it belongs to and cannot outlive it (`form_drafts.form_id` references `forms`), so
 * it goes when the form goes - and the report says so when there was one, rather than
 * letting an operator discover it.
 */
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

/** What one `clear` did, so the report is rendered from facts rather than assembled inline. */
export interface ClearOutcome {
  readonly questions: number;
  readonly versions: number;
  readonly forms: number;
  readonly formVersions: number;
  /** An open draft on the seeded form went with it; it cannot outlive the form. */
  readonly draft: boolean;
  /** The ids removed, in corpus order. */
  readonly removed: readonly string[];
  /** Ids in the derived set whose rows were NOT this seed's, with the reason. */
  readonly left: readonly Recognition[];
}

/**
 * What a completed `clear` prints. Pure and exported so the guarantee in the last line is
 * asserted rather than reviewed - it is the line issue #994's review found to be false.
 *
 * The old closing sentence was "Nothing else was touched: hand-authored questions and
 * forms are still there", printed unconditionally, and two measured cases broke it. What
 * replaces it claims only what {@link recogniseQuestion} can deliver: rows this seed did
 * not write were left in place. An exact byte-for-byte recreation of a seeded row is
 * indistinguishable from the seed's own and is not excepted from that sentence, because
 * the sentence is about what the seed WROTE rather than about who typed it.
 */
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

/**
 * Remove the rows this seed wrote, and only those: its questions and their versions, its
 * form, the form's versions, and the draft the form may be carrying.
 *
 * Every id in the derived set is recognised by content first ({@link recogniseQuestion},
 * {@link recogniseForm}) and skipped when the rows under it are not what this seed writes.
 * The report then says exactly what happened, including what it left and why, because the
 * sentence this used to end on ("Nothing else was touched") was a guarantee `clear` could
 * break: it broke for a question an operator authored under a corpus id and for an
 * operator's extra version on a seeded question, and printing the reassurance is what made
 * either silent.
 */
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

/**
 * Load the sample library and publish the sample form (`pnpm dev:seed`).
 *
 * The states are arranged even when the form could not be published, so a refused publish
 * still leaves a coherent library: a second run would skip every question it created and
 * never get back to the arranging. The refusal is raised afterwards, so the exit code says
 * the run did not do all of what it set out to.
 */
export async function seed(db: Db): Promise<void> {
  const fixtures = readQuestionFixtures();
  const created = await seedQuestions(db, fixtures);
  const refusal = await seedForm(db);
  await arrangeQuestionStates(db, created);
  if (refusal !== undefined) throw new PublishRefused(refusal);
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
  if (error instanceof ClearRefused || error instanceof PublishRefused) return error.message;
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
