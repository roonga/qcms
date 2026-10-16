# Workspaces: ownership, moving and archiving (task 068)

ADR-41: a **workspace** is an authorisation grouping that owns forms and questions. It is
not tenancy (ADR-04) and not an isolation guarantee: the boundary is an authorisation check
in the API, no URL carries a workspace, and nothing here is per-workspace configuration.

This slice is the **container**. It grants nothing: the six roles, the scope, the
access-group names, the resolver, the middleware, the grant write path and the SEC-15
audit are task 069's, and the two-person rule for `prod` is 070's. These routes sit behind
the SEC-4 channel token and the admin-session gate every other admin slice sits behind,
and behind nothing else.

## Routes

| Method | Path                        | Scope             | Notes                                                                                            |
| ------ | --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `GET`  | `/workspaces`               | `forms:read`      | Every workspace with what it owns, oldest first, archived ones included.                         |
| `POST` | `/workspaces`               | `forms:write`     | The one path by which a workspace comes into existence. The caller becomes its `forms.owner`.    |
| `PUT`  | `/workspaces/{id}/shared`   | `forms:write`     | Mark this workspace as the installation's shared question library, or unmark it. At most one is. |
| `POST` | `/workspaces/{id}/archive`  | `forms:write`     | Archive it. Refused while it owns any form or is the shared library. There is no unarchive.      |
| `POST` | `/forms/{id}/workspace`     | `forms:write`     | Move a form. One `UPDATE` on the identity row.                                                   |
| `POST` | `/questions/{id}/workspace` | `questions:write` | Move a question (Q14). One `UPDATE` on the identity row, touching no version.                    |

The two **move** routes are addressed under the form and question collections and are
registered here, because what they change is ownership and because they share this slice's
"the target exists and is not archived" rule and its reason for existing: archiving is the
last step, so a workspace's forms leave first.

**There is no screen.** The plan's 068 section has none, and the workspace and membership
screens arrive with 069, where the permissions matrix that governs them is built.

## The row is better-auth's, and the rules are QCMS's

Q32 put the workspace on the organisation plugin's `organization` row rather than on a
`workspaces` table of QCMS's own, so:

- **Creation goes through the library**, server-side `createOrganization` with an explicit
  `userId` (`handler.ts`). That call writes the organisation row **and** the `member` row
  carrying `forms.owner` in one act, so a workspace never exists without an owner. The
  plugin's own HTTP endpoints are unreachable - the auth mount's allowlist names none of
  them, so all 35 answer 404 - and `allowUserToCreateOrganization: false` refuses every
  session-bound call to the one this slice uses. That is Q45: grants and membership are
  written through QCMS endpoints and nowhere else.
- **The three QCMS fields are read and written here**, through `@roonga/qcms-db`:
  `isShared`, `requireSecondApprover` and `archivedAt`, declared to the plugin as typed
  additional fields with `input: false` (Q39). `requireSecondApprover` is written by
  nothing in this task: it defaults off (Q13) and task 070 reads it.
- **The domain rules did not move with the table** (`rules.ts`): a workspace slug is
  lowercase letters, digits and hyphens - not the tighter environment rule of Q42, and
  dotted access-group names are what keeps the two from colliding - the slug of a form is
  unique installation-wide at the database, at most one workspace is shared, and the pin
  rule is what a form may newly pin.

## The shared workspace, and its asymmetry

At most one workspace is the installation's shared question library, enforced by a partial
unique index (`organization_shared_uq`) as well as by a legible refusal here. Finding 10's
asymmetry is the design:

- **every workspace's editors see and may pin** its questions, which is enforced at publish
  by the workspace pin gate in the forms slice (`FOREIGN_WORKSPACE_PIN`);
- **only its own members edit them**, which is `mayEditQuestion` in `rules.ts` - a pure
  rule with **no caller until task 069**, because an editor's workspace is a membership
  fact and this task resolves none. It is unit-tested on both halves (`rules.test.ts`) so
  the behaviour 069 wires up is already pinned, and ADR-41's Note records which line of
  code arrives when.

A shared question's **text** is therefore the one thing that crosses a workspace boundary.
No response ever does.

## Archiving: refuse, and name what to do next

A workspace is archived, never deleted (Q15), and the archive is **the last step rather
than a cascade**. It stamps one column and reaches no form, question, version, release or
response row, which is how ADR-17's two whole-session delete paths stay at two.

It is refused while the workspace **owns any form** or **is the shared library**, and the
refusal names the forms, reports the open and released ones separately, and says to unmark
the library or hand it on (Q64, Q65, Code Owner, 2026-10-16). Nothing is closed, moved or
unmarked on the operator's behalf: closing a form stops new sessions for real respondents,
moving one changes who can see it, and unmarking the library changes what every other
workspace may pin. Questions may stay, because they serve the pins that already exist and
can take no new one from an archived workspace.

**There is no unarchive** (Q66), and the absence is a decision recorded in ADR-41's Note.
The one write an archived workspace still takes is **unmarking** the shared library, so the
repair path Q15 needs never closes.

## Which workspace something new belongs to

`resolve.ts`. A form or a question belongs to exactly one workspace, `NOT NULL` with no
default at the database (criterion 1), while **naming** it on the request is optional:

- named: that workspace, provided it exists and is not archived;
- omitted on a one-workspace installation: that workspace, which is the ordinary case since
  a bootstrapped deployment is seeded with one;
- omitted with more than one to choose from: **refused**, naming the candidates.

The ambiguous case is a refusal rather than a default on Q19's reasoning one design over:
there is no safe default, and a form created in the wrong workspace is visible to the wrong
group from the moment it exists. The picker that will make the field ordinary is 069's.

## The first workspace

`pnpm qcms:create-admin` seeds it (`features/auth/bootstrap.ts`), through the same
server-side `createOrganization`, attributed to the account it creates, with the two-person
switch off (Q13). A fixture path that has no auth instance and no account - the test
harness, `pnpm dev:seed`, `scripts/dev-stack.mjs` - uses `ensureSeedWorkspace` instead,
which adopts the workspace an installation already has rather than adding a second beside
it.

## What this slice deliberately does not do

- **No role, no membership, no grant, no audit** (069), and no `requireSecondApprover`
  write (070).
- **No delete, in any form.** `@roonga/qcms-db` exports no workspace delete and the
  import-surface test refuses one; the reference from `forms` refuses a hand-written delete
  of a workspace that owns anything; `disableOrganizationDeletion: true` and the allowlist
  close the plugin's own door.
- **No per-workspace reporting split** (067), no workspace segment in any URL, and no
  per-workspace configuration, theming or ports.
