---
"@roonga/qcms-db": minor
---

Membership and the access audit: the SEC-15 table with its grants, the grant rows, and the
access-group names (ADR-41, task 069).

`control.access_audit` is the append-only control SEC-15 names: one row per response read,
export and erasure, per grant and revoke, and per change to the per-workspace test-data
setting, carrying actor, workspace, environment, form, kind, time and a detail. It has **no
foreign key** to the account, the workspace, the form or the environment, and that is the
point rather than an omission - an audit row that cascades away with what it describes is
not an audit row, which is `two_factor_resets`' own shape.

Its grants and its revokes ride the migration that creates it, because a revoke can only
run where the table's owner does: `SELECT` and `INSERT` for `qcms_app_control`, `INSERT`
and nothing else for every `qcms_app_<env>` in the live set, and `UPDATE` and `DELETE`
revoked from the whole `qcms_app%` prefix. The grant is owed **twice** - the migration
covers the environments that exist when it runs and `grantEnvironmentStatements` covers
every environment created afterwards, guarded on the table existing - because task 064 set
no `ALTER DEFAULT PRIVILEGES` and a control-plane table's grants are explicit or absent.

`writeAccessAuditRow` is the one helper that writes it, for **both** pools, and it carries
no `RETURNING`. The reason is the helper rather than either role: a response read's row
commits in the same transaction as the read, on the environment pool, and that role holds
`INSERT` on this table and nothing else, so a `RETURNING` - being a read - is refused for
it. The control role holds `SELECT` here and would succeed, so the rule is asserted as the
environment role.

`queries/grants.ts` carries the member, team and teamMember reads and writes, because the
QCMS endpoints are the only grant write path: that is where the validation and the audit
rows live, and the organisation plugin's removal cascades run inside the library, below any
endpoint the API could gate. `ensureWorkspaceMember` writes the member row with the empty
role that every grant holder carries, because the plugin's own team queries assume a team
member is a member of the organisation the team belongs to.

`access-groups.ts` is the naming convention as pure derivations: the stored name
`<environments>.<role>[.<label>]`, the derived full and directory names that are stored
nowhere, and the combined-set ordering - an environment set is written in the order of the
rows in `control.environments`, normalised on write and refused when it is out of order, so
`dev-test` is the one spelling and `test-dev` is never a second grant. Nothing parses a
name to authorise: if every name in an installation were wrong, no access would change.

The environment drop command gains the access-group half of its check: it refuses while any
group's environment scope names the environment and names those groups by their derived
full name, so an operator sees which grants the drop would silence. A group scoped to `all`
does not block, because `all` names no environment.

`listForms` and `listQuestions` take an optional workspace filter, which is the
confidentiality boundary between two groups sharing one installation: an empty list is an
empty result rather than the whole table, which is the fail-closed direction.
