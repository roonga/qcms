"use server";

import { displayText } from "@/lib/agent/card-copy";
import { listAllForms } from "@/lib/server/forms";
import { listAccessGroups } from "@/lib/server/membership";
import { listQuestions } from "@/lib/server/questions";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

/* Display titles for ids a card would otherwise show raw. The reads are the forms list, the
   question library and the workspace's access groups, each one a screen the operator can
   already open; nothing here reaches the assistant. */

const MAX_IDS = 60;

/* Each read is the operator's own, and a refused one simply names nothing: the card then
   keeps the id it already had. */
function formTitles(result: Awaited<ReturnType<typeof listAllForms>>): [string, string][] {
  if (!result.ok) return [];
  return result.data.map((form) => [form.formId, displayText(form.title) ?? form.slug]);
}

function questionTitles(result: Awaited<ReturnType<typeof listQuestions>>): [string, string][] {
  if (!result.ok) return [];
  return result.data.map((question) => [
    question.questionId,
    displayText(question.label) ?? question.slug,
  ]);
}

function groupTitles(
  result: Awaited<ReturnType<typeof listAccessGroups>> | undefined,
): [string, string][] {
  if (result?.ok !== true) return [];
  return result.data.groups.map((group) => [group.teamId, group.name]);
}

export async function readSubjectTitlesAction(
  ids: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const session = await requireAdminSession();
  const wanted = new Set(ids.filter((id) => typeof id === "string" && id !== "").slice(0, MAX_IDS));
  if (wanted.size === 0) return {};

  const workspaceId = await currentWorkspaceId(session);
  const scope = workspaceId === undefined ? {} : { workspaceId };
  const [forms, questions, groups] = await Promise.all([
    listAllForms(session, workspaceId),
    listQuestions(session, scope),
    workspaceId === undefined ? undefined : listAccessGroups(session, workspaceId),
  ]);

  const found = [...formTitles(forms), ...questionTitles(questions), ...groupTitles(groups)];
  return Object.fromEntries(found.filter(([id]) => wanted.has(id)));
}
