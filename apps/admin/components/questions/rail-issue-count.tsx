"use client";

import { RailCount } from "@/components/rail-frame";
import { useQuestionPanels } from "@/lib/questions/editor-bridge";
import { tPlural } from "@/lib/i18n/en";

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
