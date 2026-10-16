import type { QuestionOwnership } from "@roonga/qcms-db";

/**
 * The workspace domain rules, as pure functions over rows (ADR-41, task 068).
 *
 * Three rules live here, and they are the ones that are **QCMS's rather than
 * better-auth's**: the table's owner moved to the organisation plugin (Q32) and these did
 * not move with it. They are pure on purpose - a row in, a verdict out - so the publish
 * path, the move path and task 069's membership middleware all answer the same question
 * the same way instead of each re-deriving it at its own call site.
 *
 * What is **not** here: who the caller is. Task 068 builds the container and grants
 * nothing, so these rules take the workspace a thing belongs to rather than a role
 * somebody holds. {@link mayEditQuestion} is where those two meet, and its own
 * documentation says which half of it has a call site today and which arrives with 069.
 */

/**
 * A workspace slug: lowercase letters, digits and hyphens, starting and ending with a
 * letter or a digit.
 *
 * **This is the workspace rule and it is not the environment rule**, which is tighter
 * (`^[a-z][a-z0-9]*$`, no hyphen at all, Q42): an environment name is interpolated into
 * `data_<env>`, into `reporting_<env>` and into a hyphen-joined access-group segment, so
 * a hyphen or an underscore in it makes a derived string impossible to parse back. A
 * workspace slug is interpolated into none of those. What it has to survive instead is
 * ADR-41's access-group name, which is **dotted** (`<environments>.<plane>.<role>`)
 * precisely so that it cannot collide with a slug: "lowercase letters, digits and
 * hyphens" is the sentence that record uses, and this is that sentence as a pattern.
 *
 * A slug is also never a path segment of its own - no URL carries a workspace (ADR-41) -
 * so this is about legibility and about the one collision above, not about routing.
 */
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The longest slug a workspace may carry. Long enough to read, short enough to list. */
export const WORKSPACE_SLUG_MAX_LENGTH = 48;

/** Whether a string is a well-formed workspace slug. */
export function isWorkspaceSlug(value: string): boolean {
  return value.length <= WORKSPACE_SLUG_MAX_LENGTH && WORKSPACE_SLUG_PATTERN.test(value);
}

/**
 * Whether a form in `formWorkspaceId` may hold a **new** pin to this question
 * (ADR-41, Q14, finding 10).
 *
 * Two cases are allowed and there is no third: the question belongs to the **form's own
 * workspace**, or it belongs to the **shared workspace**, which is the org-wide question
 * library every workspace may pin from. A question owned by another ordinary workspace is
 * refused.
 *
 * That asymmetry is the whole design of the shared workspace (finding 10): it is a read
 * surface to everybody else, which is what makes it a library rather than a place three
 * groups overwrite each other's wording. The **text** of a shared question is therefore
 * the one thing that crosses a workspace boundary, and no response ever does.
 *
 * Nothing here is about who is asking. A pin is a fact about two rows - the form's
 * workspace and the question's - so this rule holds for every caller, including the
 * installation administrator, and it needs no membership to evaluate. That is why
 * criterion 2 is enforceable in this task while the edit half of criterion 6 is a rule
 * waiting for a caller (see {@link mayEditQuestion}).
 */
export function mayPinQuestion(input: {
  readonly formWorkspaceId: string;
  readonly question: QuestionOwnership;
}): boolean {
  return input.question.workspaceId === input.formWorkspaceId || input.question.workspaceIsShared;
}

/**
 * Whether an editor whose workspace is `actorWorkspaceId` may **edit** this question.
 *
 * Only the owning workspace's own members edit a question, and **the shared workspace is
 * no exception**: that is the second half of finding 10's asymmetry and the half an
 * implementation drops, because "everyone may pin it" reads like "everyone may touch it".
 * So a shared question is readable and pinnable installation-wide
 * ({@link mayPinQuestion}) and editable only from the workspace that owns it.
 *
 * **Where this is called from, honestly stated.** An editor's workspace is a membership
 * fact, and membership is task 069's: there is no role, no member resolution and no
 * middleware in this task, so the API has nothing to pass as `actorWorkspaceId` on a
 * question-edit route yet. What this task owns is the rule and the ownership column it
 * reads; 069's resolver is the caller, on the same question routes it adds the role check
 * to. The rule is unit-tested on both halves (`rules.test.ts`) rather than left as a
 * sentence in a work order, so the behaviour 069 wires up is already pinned.
 */
export function mayEditQuestion(input: {
  readonly actorWorkspaceId: string;
  readonly questionWorkspaceId: string;
}): boolean {
  return input.actorWorkspaceId === input.questionWorkspaceId;
}
