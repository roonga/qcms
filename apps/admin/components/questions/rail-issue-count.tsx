"use client";

import { RailCount } from "@/components/rail-frame";
import { useQuestionPanels } from "@/lib/questions/editor-bridge";
import { tPlural } from "@/lib/i18n/en";

/**
 * The question rail Header's issue total, as a client island: the number lives in the
 * editor's live document, while the rest of the rail is server-rendered. Renders nothing
 * before an editor has published and nothing at zero.
 */
export function QuestionRailIssueCount() {
  const live = useQuestionPanels();
  if (live === undefined) return null;

  let total = 0;
  for (const count of live.issueCounts.values()) total += count;
  if (total === 0) return null;

  return (
    <RailCount>{tPlural("questions.rail.issuesOne", "questions.rail.issues", total)}</RailCount>
  );
}
