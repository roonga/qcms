"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { MutationState } from "@/lib/questions/editor-state";
import type { QuestionDefinitionView } from "@/lib/questions/types";
import {
  createQuestion,
  createVersion,
  deprecateVersion,
  publishVersion,
  saveVersion,
} from "@/lib/server/questions";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The question library's mutations (task 032).
 *
 * ## Why server actions rather than the route handlers task 031 used
 *
 * 031's screens are credential transitions, and every one of them is a full-page POST
 * that has to work with JavaScript off. The editor is the opposite kind of screen: it
 * holds a live document (an option list being reordered, a constraint being typed) and
 * its failure mode is a validation error that has to land on a field **without throwing
 * the author's unsaved work away**. A redirect-back-with-an-error-code round trip cannot
 * do that: the page re-renders from the stored draft, and the edit that caused the error
 * is exactly what is lost. An action returns state to the same mounted form, so the
 * document survives its own rejection.
 *
 * They are still POSTs to this origin, so `form-action 'self'` and the SameSite session
 * cookie apply unchanged, and Next verifies the request origin for every action call.
 *
 * ## Every action authenticates itself
 *
 * A server action is a POST endpoint, exactly like a route handler, and the `(shell)`
 * layout does not run for either (a layout wraps the page tree, not a request handler).
 * So every action below starts with `requireAdminSession()` rather than assuming the
 * screen that rendered the form was itself guarded. That is the same gap issue #177
 * recorded for `settings/password/route.ts`, closed here by construction.
 *
 * ## Still a proxy (R2)
 *
 * None of these decides anything. The definition arrives already assembled by the
 * editor, is parsed as JSON, and is forwarded. Whether it is a legal question is the
 * kernel's answer, returned as `INVALID_QUESTION_DEFINITION` with path-addressed issues
 * that the editor renders inline.
 */

/** Cap on the serialized definition, so a malformed post cannot make the BFF chew. */
const MAX_DEFINITION_BYTES = 64 * 1024;

/** Read the editor's serialized document, or `undefined` when it is missing or absurd. */
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

/** Read a positive integer form field. */
function readVersion(formData: FormData): number | undefined {
  const raw = formData.get("version");
  if (typeof raw !== "string") return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Read a required string form field. */
function readText(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw : "";
}

/**
 * The state for a post this BFF could not even forward.
 *
 * It reuses the kernel's own code so the editor has one error path rather than two: as
 * far as the screen is concerned, a definition it could not serialize and a definition
 * the engine rejected are the same event.
 */
const MALFORMED: MutationState = {
  status: "error",
  code: "INVALID_QUESTION_DEFINITION",
  message: "The editor could not send this draft. Reload the page and try again.",
  issues: [],
};

/** Create a question and its draft v1, then open it. */
export async function createQuestionAction(
  _previous: MutationState,
  formData: FormData,
): Promise<MutationState> {
  const session = await requireAdminSession();
  const definition = readDefinition(formData);
  const slug = readText(formData, "slug").trim();
  if (definition === undefined) return MALFORMED;

  const result = await createQuestion(session, slug, definition);
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
  // Outside the guard above on purpose: `redirect` signals by throwing, so it must not
  // sit anywhere a `catch` could swallow it.
  redirect(`/questions/${encodeURIComponent(result.data.questionId)}?v=1`);
}

/** Save an edit to a draft version. Published versions are refused by the API. */
export async function saveDraftAction(
  _previous: MutationState,
  formData: FormData,
): Promise<MutationState> {
  const session = await requireAdminSession();
  const definition = readDefinition(formData);
  const questionId = readText(formData, "questionId");
  const version = readVersion(formData);
  if (definition === undefined || version === undefined) return MALFORMED;

  const result = await saveVersion(session, questionId, version, definition);
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

/**
 * Publish, deprecate, or open a new draft version.
 *
 * One action for the three because they are one shape (a version, an intent, no body)
 * and because the alternative is three near-identical modules whose only difference is
 * the verb. The intent is read from the form rather than bound per button so the
 * confirmation dialogs stay plain forms.
 */
export async function lifecycleAction(
  _previous: MutationState,
  formData: FormData,
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
      ? await publishVersion(session, questionId, version)
      : await deprecateVersion(session, questionId, version);
  if (!result.ok) {
    return { status: "error", code: result.code, message: result.message, issues: result.issues };
  }
  revalidatePath(`/questions/${questionId}`);
  revalidatePath("/questions");
  return { status: "saved" };
}
