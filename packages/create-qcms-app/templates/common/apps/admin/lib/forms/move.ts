import { formatList } from "../i18n/format.ts";
import { environmentLabel } from "../environment.ts";
import { t, type MessageKey } from "../i18n/en.ts";
import type { MyAccessWorkspace } from "../membership/types.ts";

/** One act a person gains or loses when the form moves, as the API's evaluator reports it. */
export interface MovedAct {
  readonly act: string;
  /** Empty for an act that ignores the environment set. */
  readonly environments: readonly string[];
}

/** Named only: the API sends the display name, or the address where the name is blank. */
export interface MovePreviewPerson {
  readonly name: string;
  readonly acts: readonly MovedAct[];
}

/** Why the move waits for an approver, or `null` when the mover applies it themselves. */
export type MoveHoldReason = "second-approval" | "not-source-administrator";

export interface MovePreview {
  readonly formId: string;
  readonly sourceWorkspaceId: string;
  readonly destinationWorkspaceId: string;
  readonly requiresApproval: boolean;
  readonly holdReason: MoveHoldReason | null;
  readonly gains: readonly MovePreviewPerson[];
  readonly losses: readonly MovePreviewPerson[];
}

export interface MoveDestination {
  readonly workspaceId: string;
  readonly name: string;
}

/** The role that carries Edit forms, which a move needs in both workspaces. */
const EDIT_FORMS = "forms.editor";

/**
 * The workspaces a move may name: the ones the caller holds Edit forms in, excluding the
 * form's own and every archived one. An installation with no second such workspace offers
 * no Move form row at all (`docs/WORKSPACE_ACCESS.md` section 9).
 */
export function moveDestinations(
  workspaces: readonly MyAccessWorkspace[],
  sourceWorkspaceId: string,
): readonly MoveDestination[] {
  return workspaces
    .filter(
      (workspace) =>
        !workspace.archived &&
        workspace.workspaceId !== sourceWorkspaceId &&
        workspace.grants.some((grant) => grant.roles.includes(EDIT_FORMS)),
    )
    .map((workspace) => ({ workspaceId: workspace.workspaceId, name: workspace.name }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

const ACT_LABELS: Readonly<Record<string, MessageKey>> = {
  "form.read": "forms.move.act.formRead",
  "form.write": "forms.move.act.formWrite",
  "form.publish": "forms.move.act.formPublish",
  "response.read": "forms.move.act.responseRead",
  "response.export": "forms.move.act.responseExport",
  "response.erase": "forms.move.act.responseErase",
};

/** One act in plain words, with the environments it applies in where it has any. */
export function describeMovedAct(act: MovedAct, locale: string): string {
  const key = ACT_LABELS[act.act];
  const named = key === undefined ? act.act : t(key);
  return act.environments.length === 0
    ? named
    : t("forms.move.actIn", {
        act: named,
        environments: formatList(act.environments.map(environmentLabel), locale),
      });
}

export function describeMovedPerson(person: MovePreviewPerson, locale: string): string {
  return t("forms.move.person", {
    person: person.name,
    acts: formatList(
      person.acts.map((act) => describeMovedAct(act, locale)),
      locale,
    ),
  });
}
