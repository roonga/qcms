"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { MutationState, QuestionCardState } from "@/lib/questions/editor-state";
import type { AgentProposalRef } from "@/lib/server/agent-proposal";
import { messageForCode } from "@/lib/questions/errors";
import type { QuestionDefinitionView } from "@/lib/questions/types";
import {
  createQuestion,
  createVersion,
  deprecateVersion,
  publishVersion,
  saveVersion,
} from "@/lib/server/questions";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

/* Every action authenticates independently; returning state preserves unsaved edits when the API rejects a
   definition. */

/* Bound the serialized definition to limit BFF work on malformed submissions. */
const MAX_DEFINITION_BYTES = 64 * 1024;

function readDefinition(formData: FormData): QuestionDefinitionView | undefined {
  const raw = formData.get("definition");
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_DEFINITION_BYTES) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as QuestionDefinitionView;
  } catch {
    return undefined;
  }
}

function readVersion(formData: FormData): number | undefined {
  const raw = formData.get("version");
  if (typeof raw !== "string") return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readText(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw : "";
}

const MALFORMED: MutationState = {
  status: "error",
  code: "INVALID_QUESTION_DEFINITION",
  message: messageForCode("INVALID_QUESTION_DEFINITION"),
  issues: [],
};

export async function createQuestionAction(
  _previous: MutationState,
  formData: FormData,
): Promise<MutationState> {
  const session = await requireAdminSession();
  const definition = readDefinition(formData);
  const slug = readText(formData, "slug").trim();
  if (definition === undefined) return MALFORMED;

  // Name the workspace the author is in: with more than one the API refuses to guess.
  const result = await createQuestion(
    session,
    slug,
    definition,
    await currentWorkspaceId(session),
  );
  if (!result.ok) {
    return {
      status: "error",
      code: result.code,
      message: result.message,
      issues: result.issues,
      submitted: { slug, definition },
    };
  }
  revalidatePath("/questions");
  // redirect throws; keep it outside catches that would swallow navigation.
  redirect(`/questions/${encodeURIComponent(result.data.questionId)}?v=1`);
}

export async function createQuestionForCardAction(
  input: { readonly slug: string; readonly definition: unknown; readonly workspaceId?: string },
  proposal?: AgentProposalRef,
): Promise<QuestionCardState> {
  const session = await requireAdminSession();
  if (typeof input.definition !== "object" || input.definition === null) {
    return { status: "error", message: messageForCode("INVALID_QUESTION_DEFINITION") };
  }
  const result = await createQuestion(
    session,
    input.slug.trim(),
    input.definition as QuestionDefinitionView,
    input.workspaceId,
    proposal,
  );
  if (!result.ok) return { status: "error", message: result.message, issues: result.issues };
  revalidatePath("/questions");
  return {
    status: "done",
    questionId: result.data.questionId,
    slug: result.data.slug,
    version: result.data.version.version,
    versionStatus: result.data.version.status,
  };
}

/* Return the new version instead of navigating so a proposal can finish its remaining steps. */
export async function createQuestionVersionForCardAction(
  questionId: string,
  proposal?: AgentProposalRef,
): Promise<QuestionCardState> {
  const session = await requireAdminSession();
  const created = await createVersion(session, questionId, proposal);
  if (!created.ok) return { status: "error", message: created.message };
  revalidatePath(`/questions/${questionId}`);
  revalidatePath("/questions");
  return {
    status: "done",
    questionId,
    version: created.data.version,
    versionStatus: created.data.status,
  };
}

export async function saveDraftAction(
  _previous: MutationState,
  formData: FormData,
  proposal?: AgentProposalRef,
): Promise<MutationState> {
  const session = await requireAdminSession();
  const definition = readDefinition(formData);
  const questionId = readText(formData, "questionId");
  const version = readVersion(formData);
  if (definition === undefined || version === undefined) return MALFORMED;

  const result = await saveVersion(session, questionId, version, definition, proposal);
  if (!result.ok) {
    return {
      status: "error",
      code: result.code,
      message: result.message,
      issues: result.issues,
      submitted: { slug: readText(formData, "slug"), definition },
    };
  }
  revalidatePath(`/questions/${questionId}`);
  revalidatePath("/questions");
  return { status: "saved" };
}

export async function lifecycleAction(
  _previous: MutationState,
  formData: FormData,
  proposal?: AgentProposalRef,
): Promise<MutationState> {
  const session = await requireAdminSession();
  const questionId = readText(formData, "questionId");
  const intent = readText(formData, "intent");
  const version = readVersion(formData);

  if (intent === "newVersion") {
    const created = await createVersion(session, questionId);
    if (!created.ok) {
      return {
        status: "error",
        code: created.code,
        message: created.message,
        issues: created.issues,
      };
    }
    revalidatePath(`/questions/${questionId}`);
    revalidatePath("/questions");
    redirect(`/questions/${encodeURIComponent(questionId)}?v=${String(created.data.version)}`);
  }

  if (version === undefined) return MALFORMED;
  if (intent !== "publish" && intent !== "deprecate") return MALFORMED;
  const result =
    intent === "publish"
      ? await publishVersion(session, questionId, version, proposal)
      : await deprecateVersion(session, questionId, version, proposal);
  if (!result.ok) {
    return { status: "error", code: result.code, message: result.message, issues: result.issues };
  }
  revalidatePath(`/questions/${questionId}`);
  revalidatePath("/questions");
  return { status: "saved" };
}
