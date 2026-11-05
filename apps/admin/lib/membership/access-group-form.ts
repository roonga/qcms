import { t, type MessageKey } from "../i18n/en.ts";

/** The roles an access group can carry. `forms.owner` belongs to the member row, never to a group. */
export const GROUP_ROLES = [
  "forms.viewer",
  "forms.editor",
  "forms.approver",
  "responses.viewer",
  "responses.eraser",
] as const;

export type GroupRole = (typeof GROUP_ROLES)[number];

const ROLE_KEYS: Readonly<Record<string, { name: MessageKey; description: MessageKey }>> = {
  "forms.viewer": {
    name: "membership.role.formsViewer.name",
    description: "membership.role.formsViewer.description",
  },
  "forms.editor": {
    name: "membership.role.formsEditor.name",
    description: "membership.role.formsEditor.description",
  },
  "forms.approver": {
    name: "membership.role.formsApprover.name",
    description: "membership.role.formsApprover.description",
  },
  "forms.owner": {
    name: "membership.role.formsOwner.name",
    description: "membership.role.formsOwner.description",
  },
  "responses.viewer": {
    name: "membership.role.responsesViewer.name",
    description: "membership.role.responsesViewer.description",
  },
  "responses.eraser": {
    name: "membership.role.responsesEraser.name",
    description: "membership.role.responsesEraser.description",
  },
};

/** A role's plain name; an unfamiliar wire value is shown as it arrived rather than hidden. */
export function roleName(role: string): string {
  const keys = ROLE_KEYS[role];
  return keys === undefined ? role : t(keys.name);
}

/** One line on what the role allows, or `undefined` for an unfamiliar wire value. */
export function roleDescription(role: string): string | undefined {
  const keys = ROLE_KEYS[role];
  return keys === undefined ? undefined : t(keys.description);
}

/** `all`, or the chosen names. */
export type ScopeChoice =
  { readonly kind: "all" } | { readonly kind: "some"; readonly chosen: readonly string[] };

export const ALL: ScopeChoice = { kind: "all" };

export function toggleAll(choice: ScopeChoice, on: boolean): ScopeChoice {
  if (on) return ALL;
  return choice.kind === "all" ? { kind: "some", chosen: [] } : choice;
}

export function toggleOne(choice: ScopeChoice, value: string, on: boolean): ScopeChoice {
  const chosen = choice.kind === "all" ? [] : choice.chosen;
  const without = chosen.filter((entry) => entry !== value);
  return { kind: "some", chosen: on ? [...without, value] : without };
}

export function isChosen(choice: ScopeChoice, value: string): boolean {
  return choice.kind === "some" && choice.chosen.includes(value);
}

/** The wire scope, ordered as `ordered` is; an empty choice sends nothing, which the API refuses. */
export function scopeOf(choice: ScopeChoice, ordered: readonly string[]): readonly string[] {
  if (choice.kind === "all") return ["all"];
  return ordered.filter((entry) => choice.chosen.includes(entry));
}

export interface EnvironmentEntry {
  readonly name: string;
  readonly position: number;
}

/** Environment names in the installation's own order, which is the order a group's name spells them in. */
export function orderedEnvironments(environments: readonly EnvironmentEntry[]): readonly string[] {
  return [...environments]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((entry) => entry.name);
}

/**
 * The name the API expects for these fields, `<environments>.<role>[.<label>]`. The API
 * still refuses a name out of step; deriving it here only spares the author typing it.
 */
export function groupNameFor(
  role: string,
  environments: readonly string[],
  label: string,
): string | undefined {
  if (environments.length === 0) return undefined;
  const trimmed = label.trim();
  return [environments.join("-"), role, ...(trimmed === "" ? [] : [trimmed])].join(".");
}

export interface NamedForm {
  readonly formId: string;
  readonly name: string;
}

/** Forms matching the search by name, chosen ones always kept so a narrowed list never hides a pick. */
export function formOptions(
  forms: readonly NamedForm[],
  search: string,
  choice: ScopeChoice,
): readonly NamedForm[] {
  const needle = search.trim().toLowerCase();
  return forms.filter(
    (form) =>
      needle === "" || form.name.toLowerCase().includes(needle) || isChosen(choice, form.formId),
  );
}

export interface GrantCandidate {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

/** Members who do not already hold this group, the only accounts a grant can name. */
export function grantCandidates(
  members: readonly GrantCandidate[],
  holders: readonly { readonly userId: string }[],
): readonly GrantCandidate[] {
  const holding = new Set(holders.map((holder) => holder.userId));
  return members.filter((member) => !holding.has(member.userId));
}

/** A scope as the group's row reads it: `all` as the catalog's word, names where known. */
export function scopeLabel(
  scope: readonly string[],
  allKey: MessageKey,
  nameOf: (value: string) => string = (value) => value,
): string {
  if (scope.length === 1 && scope[0] === "all") return t(allKey);
  return scope.map(nameOf).join(", ");
}
