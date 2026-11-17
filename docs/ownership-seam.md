# The ownership seam

**Status:** v1.0 (task 037) · companion to `ARCHITECTURE.md` §2 and ADR-05
**Audience:** adopters deciding what they are taking on, and QCMS contributors deciding
where a new file belongs.

QCMS is distributed in the shadcn ethos: some of it is **stamped into your repository
and becomes yours**, and some of it is a **versioned dependency you upgrade**. This
document is the line between the two, path by path, and what upgrading each package
actually means.

## The rule that draws the line

From `ARCHITECTURE.md` §2:

> Code a customizer would reasonably change (routes, pages, UI, adapters, theming) is
> scaffolded owned source; code whose modification would break audit or versioning
> guarantees (domain model, rules evaluation, publish compiler, migration history) is
> a versioned package.

That is not a taste judgement. It follows from what QCMS promises: a form published
today renders and evaluates identically forever (ADR-18), answers are append-only with
one erasure door (R3, ADR-17), and question identifiers are stable for life (R6). Those
promises can only be kept by code whose version is pinned, published immutably (R1) and
covered by an append-only golden corpus. Everything they do **not** depend on is
yours, and the seam is drawn exactly there.

## What being "yours" means, precisely

- **Nothing overwrites it.** There is no upgrade command that touches your tree.
  `create-qcms-app` runs once, at the start. A later QCMS release changes the packages
  you depend on and never your files.
- **It is not a fork.** The scaffolded shell is generated from the applications this
  repository develops, by
  `packages/create-qcms-app/scripts/sync-templates.mjs`, and `pnpm check:templates`
  fails CI if the two ever disagree. So what you receive is the shell QCMS itself runs,
  minus its test harness, not a snapshot someone copied.
- **You get no upstream fixes for it automatically.** That is the trade. If a bug is
  fixed in `apps/portal` here after you scaffolded, you take it by reading the diff and
  applying what you want, exactly as with a shadcn component. In exchange, your
  customisations are never in conflict with an upgrade.

## What being "versioned" means, precisely

The `@roonga/qcms-*` packages are ordinary registry dependencies with ordinary ranges in
`apps/*/package.json`. Upgrading is `install`, rebuild, and (for `@roonga/qcms-db`) migrate.
Three properties make that safe rather than hopeful:

- **Published versions are immutable (R1).** A version you have resolved cannot change
  under you.
- **The serving path never recompiles (ADR-18).** The portal serves the compiled
  document stored at publish time, so a compiler or renderer upgrade cannot alter a
  form that is already live.
- **The golden corpus is append-only (ADR-18).** A compiled-output change to an
  existing corpus entry is not a version bump decision, it is a gate failure.

## Where the seam is crossed on purpose

Two places, both narrow and both deliberate:

- **`.env`** is neither owned source nor a package: it is deployment configuration.
  `.env.example` is generated from the API's own configuration schema, so the list of
  knobs cannot drift from the code that parses them, but the values are yours.
- **The database schema** is owned by `@roonga/qcms-db` and applied to your database by
  `docker compose run --rm migrate`. Your data is yours; the shape of it is versioned.
  Adding your own tables in your own schema is supported; editing QCMS's is not, and a
  migration will disagree with you.

## Where a new file belongs

For contributors, the same rule read forwards. A new file goes in a **package** if a
respondent-visible or audit-visible behaviour depends on it being the same version
that published a form: domain types, rule semantics, compiled output, migrations, the
renderer. It goes in an **app** if it is composition, presentation, transport or
adaptation: routes, pages, BFF handlers, theming, message catalogs, the challenge
adapter. If a change to it could make a two-year-old published form render or evaluate
differently, it is a package.

## Every scaffolded path

The literal answer to "every scaffolded path" is the template tree itself,
`packages/create-qcms-app/templates/`: `common/` is stamped for both deployment shapes,
and `solo/` and `enterprise/` hold what each shape adds. `create-qcms-app` copies that
tree, so browsing it is browsing what you receive.

For a summary, `pnpm qcms:seam` prints the inventory from the same tree: a per-directory
file count, the per-shape additions and the full manifest. It is generated on demand and
not committed here, so it can never be stale and no two branches conflict over it.
`pnpm check:templates` (inside `pnpm check:all`, and so inside `pnpm verify` and CI)
fails when the template tree drifts from the applications it is generated from.

## Package dependencies stamped into `apps/*/package.json`

The ranges are in the stamped `apps/*/package.json` files. `pnpm check:templates` fails
when this table names a package the scaffold does not stamp, or misses one it does.

| Package                      | What it carries                                                                                                                          | Upgrade story                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@roonga/qcms-core`          | Domain model, the rules DSL and its forward-pass evaluator, the publish compiler, answer validation, secure-link tokens.                 | Upgrade freely within a major. Published versions are immutable (R1), so a form already published keeps the semantics it was compiled under; a new version changes what NEW publishes may express and how they evaluate. A major bump is where a semantics change would land, and would carry a migration note.                                   |
| `@roonga/qcms-a2ui-compiler` | Compiles a published form into the stored A2UI document the portal serves.                                                               | Upgrade freely. The portal serves the STORED document and never recompiles (ADR-18), so a compiler upgrade cannot alter a form that is already live: it changes what the next publish produces. The golden corpus is append-only, which is what makes that promise checkable rather than asserted.                                                |
| `@roonga/qcms-db`            | The schema, the migration history, the query helpers and the reporting view.                                                             | Upgrade, then run `docker compose run --rm migrate` as its own step before the new API instances take traffic. Migration is never done at boot, deliberately: with more than one API instance that is a race, and an operator has to be able to choose when schema changes land. Migrations are plain SQL files you can read before you run them. |
| `@roonga/qcms-ui`            | The A2UI renderer, the vendored input controls, and the token contract the theming rests on.                                             | Upgrade freely. The vendored components are pinned inside the package rather than resolved from upstream (ADR-22), so an upstream component release cannot reach a published form until a QCMS release deliberately pulls it in and re-runs the conformance suite.                                                                                |
| `@roonga/qcms-observability` | The redacting server logger, trace correlation, and the SEC-13 allowlists that decide what a log record or a span may carry off the box. | Upgrade freely, and prefer to. It is a versioned package rather than scaffolded source precisely because the allowlists are a security control: a tightening reaches every deployment through an upgrade instead of through 300 forks each editing their own copy (ADR-34, SEC-13).                                                               |
| `@roonga/qcms-csv`           | One helper: RFC 4180 quoting plus the spreadsheet formula-injection guard every exported cell passes through.                            | Upgrade freely, and prefer to, for the same reason as `@roonga/qcms-observability`. The guard is the SEC control on issue #470, and the export routes that call it are yours to edit, so the value of shipping it as a version is that a correction to the guard is an upgrade rather than a code review in every adopter's tree.                 |

## QCMS-internal references in the scaffolded source

Scaffolded source follows the Code comments rule in `PROJECT_INSTRUCTIONS.md`:
the default is no comment. Keep a concise explanation only for a non-obvious why,
a safety or security constraint, or an external-bug workaround. A citation alone
does not justify retaining a comment; remove historical narration and text the
code already explains. Preserve license headers, lint/type justifications and
required machine-read annotations.

Retained `ADR-nn` and `SEC-n` references point to `docs/adr/` and
`docs/SECURITY_DESIGN.md` in the upstream QCMS repository. Keep an upstream issue
number only when it is the sole pointer to a non-obvious constraint. Change the
authored source and regenerate its scaffold mirror with `pnpm qcms:sync-templates`.

The two places QCMS's identity would have been more than a citation are fixed
rather than documented: the images no longer claim to be built from this
repository, and no scaffolded message names a script your project does not define.

## What the scaffold deliberately passes on

- **The supply-chain release-age hold** (SEC-11, issue #455). The stamped
  `pnpm-workspace.yaml` carries `minimumReleaseAge: 1440` and
  `minimumReleaseAgeStrict: true`, so a version published in the last 24 hours is not
  installed and an install that needs one fails rather than exempting itself. This is
  inherited on purpose: an adopter resolves a dependency tree the same size as this
  repository's, from the same registry, with the same exposure, and a control worth
  having here is worth having there. It is your file and you may lower or remove it;
  if you keep it, keep both keys, because pnpm only defaults the strict flag on when
  the age is explicitly configured. `pnpm check:templates` fails if this repository
  holds new releases and the scaffold stops doing so.

## What the scaffold deliberately leaves out

- **This repository's test harness.** Testcontainers, Playwright, the seat-aware port
  harness, fixtures and the golden corpus are QCMS's own tooling. You are free to add
  your own tests to your own shell; you are not inheriting ours.
- **Lint configuration.** No `eslint.config.js`, no `lint` script, no ESLint
  dependency. QCMS's rule set encodes QCMS's conventions (the kernel's no-database
  import rule, the single-component-stack rule of ADR-22, its own sonarjs tuning), and
  inheriting it would mean inheriting opinions about code you now own. The scaffolded
  apps keep `build` and `typecheck`, which check facts rather than taste; linting is
  yours to choose. Note the consequence: the shell arrives with roughly 260 source
  files that nothing in your project lints until you set that up.
- **Kubernetes and managed-cloud manifests.** Ingress is operator infrastructure
  (ADR-20). The solo shape ships an optional Caddy overlay for a single host; the
  enterprise shape assumes you already have a load balancer.
- **Multi-tenancy.** A QCMS deployment is single-tenant (R7). Running several is
  running several deployments.
