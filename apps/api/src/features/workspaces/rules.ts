import type { QuestionOwnership } from "@roonga/qcms-db";

/**
 * Not the environment rule, which is tighter (no hyphen at all, Q42) because an
 * environment name is interpolated into `data_<env>` and into hyphen-joined access-group
 * segments. A workspace slug is interpolated into none of those; what it has to survive
 * is ADR-41's dotted access-group name, which a slug can never collide with.
 */
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const WORKSPACE_SLUG_MAX_LENGTH = 48;

export function isWorkspaceSlug(value: string): boolean {
  return value.length <= WORKSPACE_SLUG_MAX_LENGTH && WORKSPACE_SLUG_PATTERN.test(value);
}

/**
 * A pin is a fact about two rows, so this holds for every caller, the installation
 * administrator included, and needs no membership to evaluate. The text of a shared
 * question is the one thing that crosses a workspace boundary; no response ever does.
 */
export function mayPinQuestion(input: {
  readonly formWorkspaceId: string;
  readonly question: QuestionOwnership;
}): boolean {
  return input.question.workspaceId === input.formWorkspaceId || input.question.workspaceIsShared;
}

/**
 * The shared workspace is no exception: a shared question is pinnable installation-wide
 * ({@link mayPinQuestion}) but editable only from the workspace that owns it.
 */
export function mayEditQuestion(input: {
  readonly actorWorkspaceId: string;
  readonly questionWorkspaceId: string;
}): boolean {
  return input.actorWorkspaceId === input.questionWorkspaceId;
}
