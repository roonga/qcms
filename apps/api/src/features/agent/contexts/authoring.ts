import { z } from "zod";

import {
  environmentStatesByForm,
  getDraft,
  getFormEnvironmentState,
  getLatestPublishedVersion,
  latestVersionsByForm,
  listForms,
  listFormReleases,
  listFormVersions,
  listQuestionVersions,
  listQuestions,
  listSecureLinks,
  publishedTitlesByForm,
  listActiveWorkspaces,
} from "@roonga/qcms-db";
import type { FormId } from "@roonga/qcms-core";

import {
  FACT_ROW_LIMIT,
  Instant,
  iso,
  requireCell,
  requireForm,
  requireQuestion,
  workspacesHolding,
  type ScreenBuildInput,
} from "./support.js";

/**
 * The authoring screens' facts: structure, configuration and release state, which is
 * everything these screens show. No screen here reaches a response (SEC-17).
 */

/** Author-written text, resolved to one locale so a fact line is a string. */
function titleText(value: unknown, locale: string): string | null {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return null;
  const map = value as Record<string, unknown>;
  const named = map[locale];
  if (typeof named === "string") return named;
  const first = Object.values(map).find((entry) => typeof entry === "string");
  return typeof first === "string" ? first : null;
}

const FormListRow = z.strictObject({
  formId: z.string(),
  slug: z.string(),
  title: z.string().nullable(),
  latestVersion: z.number().int().nullable(),
  releasedVersion: z.number().int().nullable(),
  closed: z.boolean(),
});

export const formsListFacts = z.strictObject({
  environment: z.string(),
  formCount: z.number().int(),
  forms: z.array(FormListRow),
});

async function buildFormsList(input: ScreenBuildInput): Promise<z.infer<typeof formsListFacts>> {
  const workspaceIds = await workspacesHolding(input, { resource: "form", action: "read" });
  const exec = input.deps.databases.control;
  const all = await listForms(exec, { workspaceIds });
  const shown = all.slice(0, FACT_ROW_LIMIT);
  const ids = shown.map((form) => form.formId);
  const [titles, latest, states] = await Promise.all([
    publishedTitlesByForm(exec, ids),
    latestVersionsByForm(exec, ids),
    environmentStatesByForm(exec, input.environment, ids),
  ]);
  return {
    environment: input.environment,
    formCount: all.length,
    forms: shown.map((form) => ({
      formId: form.formId,
      slug: form.slug,
      title: titleText(titles.get(form.formId), form.defaultLocale),
      latestVersion: latest.get(form.formId) ?? null,
      releasedVersion: states.get(form.formId)?.version ?? null,
      closed: states.get(form.formId)?.closed ?? false,
    })),
  };
}

export const newFormFacts = z.strictObject({
  workspaces: z.array(z.strictObject({ workspaceId: z.string(), name: z.string() })),
});

async function buildNewForm(input: ScreenBuildInput): Promise<z.infer<typeof newFormFacts>> {
  const workspaceIds = await workspacesHolding(input, { resource: "form", action: "write" });
  const workspaces = await listActiveWorkspaces(input.deps.databases.control);
  return {
    workspaces: workspaces
      .filter((workspace) => workspaceIds.includes(workspace.id))
      .slice(0, FACT_ROW_LIMIT)
      .map((workspace) => ({ workspaceId: workspace.id, name: workspace.name })),
  };
}

/**
 * The facts every form-subtree screen shares. The draft definition itself travels through
 * the builder's own context port rather than here, so one shape serves every screen of the
 * subtree without a second copy of the draft.
 */
const FormSubjectFacts = {
  formId: z.string(),
  slug: z.string(),
  title: z.string().nullable(),
  environment: z.string(),
  hasDraft: z.boolean(),
  latestPublishedVersion: z.number().int().nullable(),
  releasedVersion: z.number().int().nullable(),
  closed: z.boolean(),
  challengeRequired: z.boolean(),
} as const;

type FormSubject = {
  readonly [K in keyof typeof FormSubjectFacts]: z.infer<(typeof FormSubjectFacts)[K]>;
};

async function formSubject(input: ScreenBuildInput, formId: FormId): Promise<FormSubject> {
  const exec = input.deps.databases.control;
  const form = (await requireForm(input)).row;
  const [draft, published, state, titles] = await Promise.all([
    getDraft(exec, formId),
    getLatestPublishedVersion(exec, formId),
    getFormEnvironmentState(exec, formId, input.environment),
    publishedTitlesByForm(exec, [formId]),
  ]);
  return {
    formId,
    slug: form.slug,
    title: titleText(titles.get(formId), form.defaultLocale),
    environment: input.environment,
    hasDraft: draft !== undefined,
    latestPublishedVersion: published?.version ?? null,
    releasedVersion: state?.version ?? null,
    closed: state?.closed ?? false,
    challengeRequired: form.challengeRequired,
  };
}

/** The form-subtree screens all require the same cell as the screen's own read. */
async function subjectFor(input: ScreenBuildInput): Promise<FormSubject> {
  const { formId, workspaceId } = await requireForm(input);
  await requireCell(input, { workspaceId, resource: "form", action: "read" });
  return formSubject(input, formId);
}

const StepFact = z.strictObject({
  stepId: z.string(),
  title: z.string().nullable(),
  questionCount: z.number().int(),
});

export const builderFacts = z.strictObject({
  ...FormSubjectFacts,
  stepCount: z.number().int(),
  questionCount: z.number().int(),
  ruleCount: z.number().int(),
  steps: z.array(StepFact),
});

interface DraftShape {
  readonly steps?: readonly {
    readonly stepId?: unknown;
    readonly title?: unknown;
    readonly questions?: readonly unknown[];
  }[];
  readonly rules?: readonly unknown[];
}

function draftShape(definition: unknown, locale: string): z.infer<typeof builderFacts>["steps"] {
  const steps = (definition as DraftShape | undefined)?.steps ?? [];
  return steps.slice(0, FACT_ROW_LIMIT).map((step) => ({
    stepId: typeof step.stepId === "string" ? step.stepId : "",
    title: titleText(step.title, locale),
    questionCount: step.questions?.length ?? 0,
  }));
}

async function structureFacts(
  input: ScreenBuildInput,
): Promise<z.infer<typeof builderFacts>> {
  const { formId, workspaceId, row } = await requireForm(input);
  await requireCell(input, { workspaceId, resource: "form", action: "read" });
  const subject = await formSubject(input, formId);
  const draft = await getDraft(input.deps.databases.control, formId);
  const definition =
    draft?.definition ??
    (await getLatestPublishedVersion(input.deps.databases.control, formId))?.definition;
  const steps = draftShape(definition, row.defaultLocale);
  const shape = definition as DraftShape | undefined;
  return {
    ...subject,
    stepCount: shape?.steps?.length ?? 0,
    questionCount: (shape?.steps ?? []).reduce(
      (total, step) => total + (step.questions?.length ?? 0),
      0,
    ),
    ruleCount: shape?.rules?.length ?? 0,
    steps,
  };
}

export const rulesFacts = builderFacts;
export const previewFacts = builderFacts;

const VersionFact = z.strictObject({
  version: z.number().int(),
  publishedAt: Instant,
  releasedIn: z.array(z.string()),
});

export const versionsFacts = z.strictObject({
  ...FormSubjectFacts,
  versions: z.array(VersionFact),
});

async function buildVersions(input: ScreenBuildInput): Promise<z.infer<typeof versionsFacts>> {
  const subject = await subjectFor(input);
  const formId = subject.formId as FormId;
  const exec = input.deps.databases.control;
  const [versions, releases] = await Promise.all([
    listFormVersions(exec, formId),
    listFormReleases(exec, formId),
  ]);
  const whereReleased = new Map<number, Set<string>>();
  for (const release of releases) {
    const named = whereReleased.get(release.version) ?? new Set<string>();
    named.add(release.environment);
    whereReleased.set(release.version, named);
  }
  return {
    ...subject,
    versions: versions.slice(0, FACT_ROW_LIMIT).map((version) => ({
      version: version.version,
      publishedAt: iso(version.publishedAt),
      releasedIn: [...(whereReleased.get(version.version) ?? [])],
    })),
  };
}

export const versionDetailFacts = z.strictObject({
  ...FormSubjectFacts,
  version: z.number().int().nullable(),
  publishedAt: Instant,
  releasedIn: z.array(z.string()),
  stepCount: z.number().int(),
  questionCount: z.number().int(),
});

async function buildVersionDetail(
  input: ScreenBuildInput,
): Promise<z.infer<typeof versionDetailFacts>> {
  const subject = await subjectFor(input);
  const formId = subject.formId as FormId;
  const exec = input.deps.databases.control;
  const [versions, releases] = await Promise.all([
    listFormVersions(exec, formId),
    listFormReleases(exec, formId),
  ]);
  const asked = input.params.version;
  const row = versions.find((version) => version.version === asked);
  const shape = row?.definition as DraftShape | undefined;
  return {
    ...subject,
    version: row?.version ?? null,
    publishedAt: iso(row?.publishedAt),
    releasedIn: [
      ...new Set(
        releases
          .filter((release) => release.version === row?.version)
          .map((release) => release.environment),
      ),
    ],
    stepCount: shape?.steps?.length ?? 0,
    questionCount: (shape?.steps ?? []).reduce(
      (total, step) => total + (step.questions?.length ?? 0),
      0,
    ),
  };
}

const ReleaseFact = z.strictObject({
  environment: z.string(),
  version: z.number().int(),
  releasedAt: Instant,
  releasedBy: z.string(),
  approvedBy: z.string().nullable(),
  fromEnvironment: z.string().nullable(),
  replacedVersion: z.number().int().nullable(),
  rollback: z.boolean(),
  closed: z.boolean(),
});

export const releasesFacts = z.strictObject({
  ...FormSubjectFacts,
  releases: z.array(ReleaseFact),
});

async function buildReleases(input: ScreenBuildInput): Promise<z.infer<typeof releasesFacts>> {
  const subject = await subjectFor(input);
  const releases = await listFormReleases(
    input.deps.databases.control,
    subject.formId as FormId,
  );
  return {
    ...subject,
    releases: releases.slice(0, FACT_ROW_LIMIT).map((release) => ({
      environment: release.environment,
      version: release.version,
      releasedAt: iso(release.releasedAt),
      releasedBy: release.releasedBy,
      approvedBy: release.approvedBy,
      fromEnvironment: release.fromEnvironment,
      replacedVersion: release.replacedVersion,
      rollback: release.rollback,
      closed: release.closed,
    })),
  };
}

export const linksFacts = z.strictObject({
  ...FormSubjectFacts,
  // No token exists to send: a link's URL is a bearer credential and is never minted here.
  links: z.array(
    z.strictObject({
      linkId: z.string(),
      state: z.enum(["active", "consumed", "revoked", "expired"]),
      oneTime: z.boolean(),
      expiresAt: Instant,
      createdAt: Instant,
    }),
  ),
  activeCount: z.number().int(),
});

async function buildLinks(input: ScreenBuildInput): Promise<z.infer<typeof linksFacts>> {
  const { formId, workspaceId } = await requireForm(input);
  await requireCell(input, { workspaceId, resource: "link", action: "read" });
  const subject = await formSubject(input, formId);
  const links = await listSecureLinks(input.deps.databases.control, formId, input.environment);
  const now = input.deps.clock.now();
  const stateOf = (link: (typeof links)[number]): "active" | "consumed" | "revoked" | "expired" => {
    if (link.revokedAt !== null) return "revoked";
    if (link.consumedAt !== null) return "consumed";
    return link.expiresAt.getTime() <= now.getTime() ? "expired" : "active";
  };
  const rows = links.map((link) => ({
    linkId: link.linkId,
    state: stateOf(link),
    oneTime: link.oneTime,
    expiresAt: iso(link.expiresAt),
    createdAt: iso(link.createdAt),
  }));
  return {
    ...subject,
    links: rows.slice(0, FACT_ROW_LIMIT),
    activeCount: rows.filter((link) => link.state === "active").length,
  };
}

const QuestionFact = z.strictObject({
  questionId: z.string(),
  slug: z.string(),
  latestVersion: z.number().int(),
  latestStatus: z.string(),
  publishedAt: Instant,
});

export const questionsFacts = z.strictObject({
  questionCount: z.number().int(),
  questions: z.array(QuestionFact),
});

async function buildQuestions(input: ScreenBuildInput): Promise<z.infer<typeof questionsFacts>> {
  const workspaceIds = await workspacesHolding(input, { resource: "question", action: "read" });
  const all = await listQuestions(input.deps.databases.control, { workspaceIds });
  return {
    questionCount: all.length,
    questions: all.slice(0, FACT_ROW_LIMIT).map((question) => ({
      questionId: question.questionId,
      slug: question.slug,
      latestVersion: question.latestVersion,
      latestStatus: question.latestStatus,
      publishedAt: iso(question.publishedAt),
    })),
  };
}

export const newQuestionFacts = z.strictObject({
  workspaces: z.array(z.strictObject({ workspaceId: z.string(), name: z.string() })),
});

async function buildNewQuestion(
  input: ScreenBuildInput,
): Promise<z.infer<typeof newQuestionFacts>> {
  const workspaceIds = await workspacesHolding(input, { resource: "question", action: "write" });
  const workspaces = await listActiveWorkspaces(input.deps.databases.control);
  return {
    workspaces: workspaces
      .filter((workspace) => workspaceIds.includes(workspace.id))
      .slice(0, FACT_ROW_LIMIT)
      .map((workspace) => ({ workspaceId: workspace.id, name: workspace.name })),
  };
}

export const questionDetailFacts = z.strictObject({
  questionId: z.string(),
  versions: z.array(
    z.strictObject({
      version: z.number().int(),
      status: z.string(),
      publishedAt: Instant,
      type: z.string().nullable(),
    }),
  ),
});

async function buildQuestionDetail(
  input: ScreenBuildInput,
): Promise<z.infer<typeof questionDetailFacts>> {
  const { questionId, workspaceId } = await requireQuestion(input);
  await requireCell(input, { workspaceId, resource: "question", action: "read" });
  const versions = await listQuestionVersions(input.deps.databases.control, questionId);
  return {
    questionId,
    versions: versions.slice(0, FACT_ROW_LIMIT).map((version) => {
      const type = (version.definition as { readonly type?: unknown }).type;
      return {
        version: version.version,
        status: version.status,
        publishedAt: iso(version.publishedAt),
        type: typeof type === "string" ? type : null,
      };
    }),
  };
}

export const authoringContexts = {
  formsList: { facts: formsListFacts, build: buildFormsList },
  newForm: { facts: newFormFacts, build: buildNewForm },
  builder: { facts: builderFacts, build: structureFacts },
  rules: { facts: rulesFacts, build: structureFacts },
  preview: { facts: previewFacts, build: structureFacts },
  versions: { facts: versionsFacts, build: buildVersions },
  versionDetail: { facts: versionDetailFacts, build: buildVersionDetail },
  releases: { facts: releasesFacts, build: buildReleases },
  links: { facts: linksFacts, build: buildLinks },
  questions: { facts: questionsFacts, build: buildQuestions },
  newQuestion: { facts: newQuestionFacts, build: buildNewQuestion },
  questionDetail: { facts: questionDetailFacts, build: buildQuestionDetail },
} as const;
