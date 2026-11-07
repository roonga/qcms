/** A workspace is an access boundary, so one list never spans two: every area reads the current one only. */

export interface WorkspaceChoice {
  readonly workspaceId: string;
  readonly name: string;
}

export interface WorkspaceContext {
  /** Every workspace the signed-in user may open, by name. */
  readonly choices: readonly WorkspaceChoice[];
  readonly current: WorkspaceChoice | undefined;
}

export const NO_WORKSPACE_CONTEXT: WorkspaceContext = { choices: [], current: undefined };

export function workspaceChoicesByName(
  choices: readonly WorkspaceChoice[],
): readonly WorkspaceChoice[] {
  return [...choices].sort(
    (left, right) =>
      left.name.localeCompare(right.name, "en") ||
      left.workspaceId.localeCompare(right.workspaceId),
  );
}

/**
 * The remembered choice, or the first permitted workspace by name. A remembered workspace
 * the caller can no longer open is discarded rather than refused: the cookie is a
 * navigation preference, never authorization.
 */
export function workspaceContextFor(
  remembered: string | undefined,
  choices: readonly WorkspaceChoice[],
): WorkspaceContext {
  const byName = workspaceChoicesByName(choices);
  const kept = byName.find((choice) => choice.workspaceId === remembered);
  return { choices: byName, current: kept ?? byName[0] };
}

/** Drawn only where there is a choice to make; one workspace leaves the bar as it ships. */
export function offersWorkspaceChoice(context: WorkspaceContext): boolean {
  return context.choices.length > 1;
}
