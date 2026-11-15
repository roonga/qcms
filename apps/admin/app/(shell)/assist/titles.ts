"use server";

import { displayText } from "@/lib/agent/card-copy";
import { listAllForms } from "@/lib/server/forms";
import { listQuestions } from "@/lib/server/questions";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

/* Display titles for ids a card would otherwise show raw. The reads are the forms list and the
   question library the operator can already open; nothing here reaches the assistant. */

const MAX_IDS = 60;

export async function readSubjectTitlesAction(
  ids: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const session = await requireAdminSession();
  const wanted = new Set(ids.filter((id) => typeof id === "string" && id !== "").slice(0, MAX_IDS));
  if (wanted.size === 0) return {};

  const workspaceId = await currentWorkspaceId(session);
  const scope = workspaceId === undefined ? {} : { workspaceId };
  const [forms, questions] = await Promise.all([
    listAllForms(session, workspaceId),
    listQuestions(session, scope),
  ]);

  const titles: Record<string, string> = {};
  if (forms.ok) {
    for (const form of forms.data) {
      if (wanted.has(form.formId)) titles[form.formId] = displayText(form.title) ?? form.slug;
    }
  }
  if (questions.ok) {
    for (const question of questions.data) {
      if (wanted.has(question.questionId)) {
        titles[question.questionId] = displayText(question.label) ?? question.slug;
      }
    }
  }
  return titles;
}
