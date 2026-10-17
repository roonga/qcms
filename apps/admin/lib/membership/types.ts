/**
 * The membership screens' view types (ADR-41, task 069).
 *
 * Shapes of what the API answers, read by the screens and the client components. Nothing
 * here decides anything: the API is the sole authority for what a grant means and who may
 * change it (R2), and the admin never imports `@roonga/qcms-core` or `@roonga/qcms-db`.
 *
 * **The role names are strings here and that is deliberate.** They are the API's
 * vocabulary, declared in `apps/api/src/features/membership/policy.ts`, and a copy of the
 * union in this app would be a second place the six roles live - which is exactly the
 * drift ADR-41's "nothing parses a name to authorise" rule is about one level down. The
 * screens render what came back and the scope chooser offers what the API's own
 * `scopeNote` explains.
 */

/** One workspace, as the list screen shows it. */
export interface WorkspaceListItem {
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly isShared: boolean;
  readonly requireSecondApprover: boolean;
  /**
   * F17's optional seed, as a visible setting rather than a habit (Q39, Q57).
   *
   * On the list rather than on a settings route of its own, because the screen that writes
   * it has to open on the value it has: a panel that guessed `false` would present a
   * statement about personal data as though nobody had chosen it.
   */
  readonly seedNewEditorsWithTestData: boolean;
  readonly archivedAt: string | null;
  readonly forms: number;
  readonly questions: number;
}

/** One member row: the account, and the access groups it holds in this workspace. */
export interface WorkspaceMember {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  /** `forms.owner`, or the empty `member` role, which grants nothing on its own. */
  readonly role: string;
  readonly groups: readonly string[];
}

/** One access group: one grant, with its scope and its holders. */
export interface AccessGroup {
  readonly teamId: string;
  /** The stored name, shown inside a workspace page. */
  readonly name: string;
  /** `<workspace>.<team>`, derived by the API and stored nowhere. */
  readonly fullName: string;
  /** `qcms.<workspace>.<team>`, the directory name task C3 will map on. */
  readonly directoryName: string;
  readonly role: string;
  readonly environments: readonly string[];
  readonly forms: readonly string[];
  readonly externalGroupId: string | null;
  readonly holders: readonly { readonly userId: string; readonly email: string }[];
}

/** The access-group list, with the one sentence the API prints beside the scope chooser. */
export interface AccessGroupList {
  readonly workspaceId: string;
  readonly groups: readonly AccessGroup[];
  /**
   * `all` on a `forms.editor` is `dev` and `test` in effect.
   *
   * Served by the API rather than written in this catalog, because it is a statement
   * about the permissions matrix rather than interface copy: every production action
   * belongs to a `forms.approver`, and that is true where the matrix is enforced.
   */
  readonly scopeNote: string;
}

/** The two per-workspace switches. */
export interface WorkspaceSettings {
  readonly workspaceId: string;
  readonly requireSecondApprover: boolean;
  readonly seedNewEditorsWithTestData: boolean;
}

/** One SEC-15 row, as the audit panel shows it. */
export interface AuditRow {
  readonly id: string;
  readonly actor: string;
  /** Resolved for display; the row carries no key to the account, by design. */
  readonly actorEmail: string | null;
  readonly environment: string | null;
  readonly formId: string | null;
  readonly kind: string;
  readonly occurredAt: string;
  readonly detail: string | null;
}

export interface AuditPage {
  readonly workspaceId: string;
  readonly rows: readonly AuditRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** One grant the signed-in administrator holds, from the capability endpoint. */
export interface HeldGrant {
  readonly name: string;
  readonly role: string;
  readonly environments: readonly string[];
  readonly forms: readonly string[];
}

/** What the signed-in administrator holds, per workspace. */
export interface MyAccessWorkspace {
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
  readonly archived: boolean;
  readonly memberRole: string | null;
  readonly grants: readonly HeldGrant[];
  /** The environments held in some grant, which is what the switcher offers. */
  readonly environments: readonly string[];
}

export interface MyAccess {
  readonly userId: string;
  readonly installationAdmin: boolean;
  readonly workspaces: readonly MyAccessWorkspace[];
}

/** What a Server Action reports back to the component that called it. */
export type MembershipActionState =
  | { readonly status: "idle" }
  | { readonly status: "done"; readonly message: string }
  | { readonly status: "error"; readonly message: string };
