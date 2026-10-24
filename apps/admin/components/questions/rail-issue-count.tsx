"use client";

import { RailCount } from "@/components/rail-frame";
import { useQuestionPanels } from "@/lib/questions/editor-bridge";
import { tPlural } from "@/lib/i18n/en";

/**
 * The question rail's Header count: how many issues the live document is carrying
 * (Code Owner ruling on issue #1117, 2026-10-24).
 *
 * ## Why this is a component of its own
 *
 * The 2026-10-24 clarification to §7.0 gives the collapsed Header "the issue total on the
 * form and question rails", and the form rail has carried one since #1116 because its total
 * is server data: the API's verdict arrives with the draft. The question rail's does not.
 * Its badges come from the EDITOR's live document, through
 * `lib/questions/editor-bridge.ts` - the same store the panel rows read their per-panel
 * counts from - and that store only exists in the browser.
 *
 * #1116 left the count out for that reason and the ruling overrides it: build the count as a
 * client island in the frame's existing `count` slot and keep the rest of the rail
 * server-rendered. That is what this file is, and it is the whole of the client half. The
 * version list, the details group, the back link and the marked row stay resolved on the
 * server from the address, which is what lets the marked row and the rendered panel agree
 * before anything has hydrated - the property `question-versions-rail.tsx` exists to keep.
 *
 * ## Nothing before hydration, nothing at zero, and no layout shift either way
 *
 * `useQuestionPanels()` answers `undefined` until an editor has mounted and published, so
 * the first paint renders nothing here. After hydration it renders nothing until there is
 * something to say: a count appears only ABOVE zero, which is the rule every issue badge in
 * this app follows (a rail with no refusal behind it has no all-clear to fabricate).
 *
 * Neither absence costs a reflow. The badge is an inline member of the summary's flex line
 * and the line's height is set by the title beside it, which is taller; the one line that
 * flexes is the title, and it is the member that gives way when a count appears (the
 * `.qcms-rail__summary-text` rule in `app/globals.css`, which is why a count never
 * truncates and the subject does).
 *
 * ## The number is the document's, not the last save's
 *
 * It is the sum of the per-panel counts the rows show, so the Header and the rows are two
 * renders of one value. A refused save fills them; a successful one clears them, because the
 * editor republishes with no issues and this reads the same snapshot. That is the behaviour
 * the ruling asks to be tested, and it is a property of the seam rather than of this file -
 * nothing here remembers a count.
 */
export function QuestionRailIssueCount() {
  const live = useQuestionPanels();
  if (live === undefined) return null;

  let total = 0;
  for (const count of live.issueCounts.values()) total += count;
  if (total === 0) return null;

  // The same two catalog entries the per-panel badges use. One wording for one device: a
  // Header reading "3 problems" over rows reading "2 issues" would be two names for one
  // fact.
  return <RailCount>{tPlural("questions.rail.issuesOne", "questions.rail.issues", total)}</RailCount>;
}
