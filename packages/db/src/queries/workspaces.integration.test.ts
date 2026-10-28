import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import { FormId, QuestionId } from "@roonga/qcms-core";
import type { FormDefinition, QuestionDefinition } from "@roonga/qcms-core";

import { authOrganization, forms, questions } from "../schema/index.js";
import {
  SEED_WORKSPACE_ID,
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";
import {
  archiveWorkspace,
  countWorkspaceContents,
  createForm,
  createQuestion,
  createQuestionVersion,
  ensureSeedWorkspace,
  findArchiveBlockers,
  getFormVersion,
  getSharedWorkspace,
  getWorkspace,
  getWorkspaceBySlug,
  insertFormRelease,
  insertFormVersion,
  listActiveWorkspaces,
  listQuestionOwnership,
  listWorkspaces,
  moveFormToWorkspace,
  moveQuestionToWorkspace,
  publishQuestionVersion,
  setWorkspaceShared,
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
const emptyQuestionDef = {} as unknown as QuestionDefinition;

/** Drizzle wraps the driver error, so the constraint, SQLSTATE and column are on the `cause`. */
async function refusal(run: () => Promise<unknown>): Promise<{
  constraint: string | undefined;
  code: string | undefined;
  column: string | undefined;
}> {
  try {
    await run();
  } catch (error) {
    const cause =
      (error as { cause?: { constraint?: string; code?: string; column?: string } }).cause ??
      (error as { constraint?: string; code?: string; column?: string });
    return { constraint: cause.constraint, code: cause.code, column: cause.column };
  }
  throw new Error("expected the statement to be refused");
}

async function makeWorkspace(slug: string): Promise<string> {
  const id = `org_${slug.replace(/-/g, "_")}`;
  await testDb.db
    .insert(authOrganization)
    .values({ id, name: slug, slug })
    .onConflictDoNothing({ target: authOrganization.id });
  return id;
}

async function seedForm(label: string, workspaceId: string): Promise<FormId> {
  const formId = FormId.parse(`frm_${label}`);
  await createForm(testDb.db, {
    workspaceId,
    formId,
    slug: `${label}-slug`,
    defaultLocale: "en",
  });
  await insertFormVersion(testDb.db, {
    formId,
    definition: emptyDef,
    compiled: emptyCompiled,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  });
  return formId;
}

describe("the workspace reference on forms and questions (criterion 1)", () => {
  it("refuses a form with no workspace, by the column and not by a convention", async () => {
    const { code, column } = await refusal(() =>
      testDb.db.execute(sql`
        insert into control.forms (form_id, slug, default_locale)
        values ('frm_unowned', 'unowned-slug', 'en')
      `),
    );
    expect(code).toBe("23502");
    expect(column).toBe("workspace_id");
  });

  it("refuses a question with no workspace the same way", async () => {
    const { code, column } = await refusal(() =>
      testDb.db.execute(sql`
        insert into control.questions (question_id, slug)
        values ('q_unowned', 'q-unowned-slug')
      `),
    );
    expect(code).toBe("23502");
    expect(column).toBe("workspace_id");
  });

  it("refuses a form in a workspace that does not exist", async () => {
    const { constraint } = await refusal(() =>
      createForm(testDb.db, {
        workspaceId: "org_never_created",
        formId: FormId.parse("frm_ghost_workspace"),
        slug: "ghost-workspace-slug",
        defaultLocale: "en",
      }),
    );
    expect(constraint).toBe("forms_workspace_id_organization_id_fk");
  });

  it("reads the owning workspace back off the identity row", async () => {
    const workspaceId = await makeWorkspace("reads-back");
    const formId = await seedForm("reads_back", workspaceId);
    const questionId = QuestionId.parse("q_reads_back");
    await createQuestion(testDb.db, { workspaceId, questionId, slug: "q-reads-back" });

    const [form] = await testDb.db.select().from(forms).where(eq(forms.formId, formId));
    const [question] = await testDb.db
      .select()
      .from(questions)
      .where(eq(questions.questionId, questionId));
    expect(form?.workspaceId).toBe(workspaceId);
    expect(question?.workspaceId).toBe(workspaceId);
  });
});

describe("the installation-wide form slug (criterion 3)", () => {
  it("refuses the same slug in a second workspace", async () => {
    const first = await makeWorkspace("slug-one");
    const second = await makeWorkspace("slug-two");
    await createForm(testDb.db, {
      workspaceId: first,
      formId: FormId.parse("frm_slug_first"),
      slug: "shared-address",
      defaultLocale: "en",
    });

    const { constraint } = await refusal(() =>
      createForm(testDb.db, {
        workspaceId: second,
        formId: FormId.parse("frm_slug_second"),
        slug: "shared-address",
        defaultLocale: "en",
      }),
    );
    expect(constraint).toBe("forms_slug_unique");
  });

  it("keeps the slug when a form moves workspaces, so no public address moves (criterion 7)", async () => {
    const from = await makeWorkspace("slug-from");
    const to = await makeWorkspace("slug-to");
    const formId = await seedForm("slug_move", from);
    const before = await getFormVersion(testDb.db, formId, 1);

    const moved = await moveFormToWorkspace(testDb.db, formId, to);
    expect(moved?.workspaceId).toBe(to);
    expect(moved?.slug).toBe("slug_move-slug");

    const after = await getFormVersion(testDb.db, formId, 1);
    expect(after).toEqual(before);
  });
});

describe("the shared workspace", () => {
  it("allows at most one, and the refusal is the database's", async () => {
    const first = await makeWorkspace("shared-first");
    const second = await makeWorkspace("shared-second");
    expect((await setWorkspaceShared(testDb.db, first, true))?.isShared).toBe(true);

    const { constraint } = await refusal(() => setWorkspaceShared(testDb.db, second, true));
    expect(constraint).toBe("organization_shared_uq");

    await setWorkspaceShared(testDb.db, first, false);
    expect((await setWorkspaceShared(testDb.db, second, true))?.isShared).toBe(true);
    expect((await getSharedWorkspace(testDb.db))?.id).toBe(second);

    // The suites below need the flag clear.
    await setWorkspaceShared(testDb.db, second, false);
    expect(await getSharedWorkspace(testDb.db)).toBeUndefined();
  });

  it("reports a question's owning workspace and whether that workspace is shared", async () => {
    const library = await makeWorkspace("ownership-library");
    const team = await makeWorkspace("ownership-team");
    await setWorkspaceShared(testDb.db, library, true);

    const sharedQuestion = QuestionId.parse("q_ownership_shared");
    const ownQuestion = QuestionId.parse("q_ownership_own");
    await createQuestion(testDb.db, {
      workspaceId: library,
      questionId: sharedQuestion,
      slug: "q-ownership-shared",
    });
    await createQuestion(testDb.db, {
      workspaceId: team,
      questionId: ownQuestion,
      slug: "q-ownership-own",
    });

    const ownership = await listQuestionOwnership(testDb.db, [sharedQuestion, ownQuestion]);
    expect(ownership).toEqual([
      { questionId: ownQuestion, workspaceId: team, workspaceIsShared: false },
      { questionId: sharedQuestion, workspaceId: library, workspaceIsShared: true },
    ]);
    expect(await listQuestionOwnership(testDb.db, [])).toEqual([]);

    await setWorkspaceShared(testDb.db, library, false);
  });
});

describe("moving a question between workspaces (Q14)", () => {
  it("is one UPDATE and touches no version", async () => {
    const from = await makeWorkspace("question-from");
    const to = await makeWorkspace("question-to");
    const questionId = QuestionId.parse("q_moves");
    await createQuestion(testDb.db, { workspaceId: from, questionId, slug: "q-moves" });
    await createQuestionVersion(testDb.db, { questionId, definition: emptyQuestionDef });
    const published = await publishQuestionVersion(testDb.db, { questionId, version: 1 });

    const moved = await moveQuestionToWorkspace(testDb.db, questionId, to);
    expect(moved?.workspaceId).toBe(to);

    const versions = await listQuestionOwnership(testDb.db, [questionId]);
    expect(versions[0]?.workspaceId).toBe(to);
    expect(published?.status).toBe("published");
  });

  it("answers `undefined` for a form or question that does not exist", async () => {
    const workspaceId = await makeWorkspace("move-nothing");
    expect(await moveFormToWorkspace(testDb.db, FormId.parse("frm_absent"), workspaceId)).toBe(
      undefined,
    );
    expect(
      await moveQuestionToWorkspace(testDb.db, QuestionId.parse("q_absent"), workspaceId),
    ).toBe(undefined);
  });
});

describe("archiving a workspace (Q15, criteria 4 and 5)", () => {
  it("names every form it owns, and says which are open and which were released", async () => {
    const workspaceId = await makeWorkspace("archive-blocked");
    const openForm = await seedForm("archive_open", workspaceId);
    const releasedForm = await seedForm("archive_released", workspaceId);
    await insertFormRelease(testDb.db, {
      formId: releasedForm,
      environment: "prod",
      version: 1,
      releasedBy: "usr_test",
      fromEnvironment: null,
    });

    const blockers = await findArchiveBlockers(testDb.db, workspaceId);
    expect(blockers.forms).toEqual([openForm, releasedForm].sort());
    expect(blockers.openForms).toEqual([releasedForm]);
    expect(blockers.releasedForms).toEqual([releasedForm]);
    expect(blockers.shared).toBe(false);

    const elsewhere = await makeWorkspace("archive-elsewhere");
    await moveFormToWorkspace(testDb.db, openForm, elsewhere);
    await moveFormToWorkspace(testDb.db, releasedForm, elsewhere);
    const cleared = await findArchiveBlockers(testDb.db, workspaceId);
    expect(cleared).toEqual({ forms: [], openForms: [], releasedForms: [], shared: false });
  });

  it("names a form in NEITHER narrower list too (Code Owner, 2026-10-16)", async () => {
    const workspaceId = await makeWorkspace("archive-closed-form");
    const unreleasedForm = await seedForm("archive_closed", workspaceId);

    const blockers = await findArchiveBlockers(testDb.db, workspaceId);
    expect(blockers.forms).toEqual([unreleasedForm]);
    expect(blockers.openForms).toEqual([]);
    expect(blockers.releasedForms).toEqual([]);
  });

  it("reports the shared library as a blocker of its own (Code Owner, 2026-10-16)", async () => {
    const workspaceId = await makeWorkspace("archive-library");
    await setWorkspaceShared(testDb.db, workspaceId, true);

    const blockers = await findArchiveBlockers(testDb.db, workspaceId);
    expect(blockers).toEqual({ forms: [], openForms: [], releasedForms: [], shared: true });

    await setWorkspaceShared(testDb.db, workspaceId, false);
    expect((await findArchiveBlockers(testDb.db, workspaceId)).shared).toBe(false);
  });

  it("stamps `archivedAt` once and leaves everything else alone", async () => {
    const workspaceId = await makeWorkspace("archive-stamp");
    const questionId = QuestionId.parse("q_archive_stamp");
    await createQuestion(testDb.db, { workspaceId, questionId, slug: "q-archive-stamp" });

    const at = new Date("2026-10-15T00:00:00.000Z");
    const archived = await archiveWorkspace(testDb.db, workspaceId, at);
    expect(archived?.archivedAt?.toISOString()).toBe(at.toISOString());

    const again = await archiveWorkspace(testDb.db, workspaceId, new Date("2027-01-01T00:00:00Z"));
    expect(again).toBeUndefined();
    expect((await getWorkspace(testDb.db, workspaceId))?.archivedAt?.toISOString()).toBe(
      at.toISOString(),
    );

    expect(await countWorkspaceContents(testDb.db, workspaceId)).toEqual({
      forms: 0,
      questions: 1,
    });
  });

  it("refuses to delete a workspace that owns anything, whatever reached the table", async () => {
    const workspaceId = await makeWorkspace("archive-undeletable");
    await seedForm("archive_undeletable", workspaceId);
    const { constraint } = await refusal(() =>
      testDb.db.delete(authOrganization).where(eq(authOrganization.id, workspaceId)),
    );
    expect(constraint).toBe("forms_workspace_id_organization_id_fk");
  });
});

describe("the seeded workspace", () => {
  it("is what a migrated harness database holds, and seeding again changes nothing", async () => {
    const seeded = await getWorkspace(testDb.db, SEED_WORKSPACE_ID);
    expect(seeded?.slug).toBe("default");
    expect(seeded?.requireSecondApprover).toBe(false);
    expect(seeded?.isShared).toBe(false);
    expect(seeded?.archivedAt).toBeNull();

    expect(await ensureSeedWorkspace(testDb.db)).toBe(SEED_WORKSPACE_ID);
    expect(await getWorkspaceBySlug(testDb.db, "default")).toEqual(seeded);
  });

  it("appears in both listings, and an archived workspace only in the full one", async () => {
    const workspaceId = await makeWorkspace("listing-archived");
    await archiveWorkspace(testDb.db, workspaceId, new Date());

    const all = (await listWorkspaces(testDb.db)).map((row) => row.id);
    const active = (await listActiveWorkspaces(testDb.db)).map((row) => row.id);
    expect(all).toContain(SEED_WORKSPACE_ID);
    expect(all).toContain(workspaceId);
    expect(active).toContain(SEED_WORKSPACE_ID);
    expect(active).not.toContain(workspaceId);
  });
});
