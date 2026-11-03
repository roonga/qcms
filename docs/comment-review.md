# Repository comment review

Audit snapshot: `582e78437d3387daa0f632667c982a17683a133b`, 2026-11-03.
The rule is in [PROJECT_INSTRUCTIONS.md](../PROJECT_INSTRUCTIONS.md#code-comments):
write no comment unless the code cannot communicate an essential fact.

## Coverage and results

| Area                                              | Result                                                         |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Tracked-file inventory                            | 2,894 files                                                    |
| Parsed authored JS/TS/CSS/JSON files              | 1,700 files                                                    |
| Regular `check:comments` gate                     | Passes, 865 files                                              |
| Admin with the exclusion removed for the scan     | 4,555 diagnostics in 500 files                                 |
| JSON configuration outside the gate               | 30 diagnostics in six additional files                         |
| Additional infrastructure/configuration inventory | 60 files; 241 comment runs longer than three lines in 46 files |

The 4,585 parser-based diagnostics comprise 2,185 history markers and 2,400 length
failures. One comment can produce multiple diagnostics. The infrastructure counts
are heuristic candidates: some runs contain commented configuration or essential
constraints and need individual review.

The inventory excludes byte-for-byte vendored A2UI, generated scaffold mirrors,
snapshots/generated artifacts and the planning scratch tree from authored-code
counts. Authored static scaffold templates are included. This is an exhaustive
mechanical inventory with targeted semantic and policy review, not a claim that
every short comment has been manually adjudicated.

## Policy corrections in this PR

- Replace the blanket instruction to retain scaffold citations in
  [ownership-seam.md](ownership-seam.md#qcms-internal-references-in-the-scaffolded-source)
  with the current necessity rule. Remove its stale citation count.
- Require a release-age exclusion comment to explain its current reason and
  removal condition, rather than naming the change that introduced it. Introduction
  history belongs in the PR, as documented in [CONTRIBUTING.md](../CONTRIBUTING.md#the-release-age-hold-minimumreleaseage-and-what-a-refusal-means).
- Distinguish explanatory version prose from machine-read annotations. Preserve
  same-line versions on SHA-pinned third-party Actions: the repository requires
  them for Dependabot. Keep the root instructions and contributor guide consistent.

## Cleanup findings

### Admin backlog

The admin exclusion is explicit in `scripts/check-comments.mjs`; the passing gate
therefore does not establish admin compliance. The largest diagnostic counts are:

| File                                           | Diagnostics |
| ---------------------------------------------- | ----------: |
| `apps/admin/app/globals.css`                   |         285 |
| `apps/admin/lib/i18n/en.ts`                    |         213 |
| `apps/admin/e2e/a11y-axe.pw.ts`                |         127 |
| `apps/admin/components/forms/form-builder.tsx` |          82 |
| `apps/admin/e2e/support/forms.ts`              |          73 |

The stylesheet and catalog introductions mix current constraints with task,
issue and ruling history. Keep concise CSS cascade and auth-enumeration constraints;
remove narration. `apps/admin/e2e/support/hydration.ts` similarly needs a short
explanation of the hydration race, with investigation history in documentation.
Sweep admin by area, regenerate scaffold mirrors and remove the exclusion once
the sweep passes.

### Gaps in file-type coverage

`SOURCE_EXTENSION` covers JS/TS/CSS, and `SOURCE_ROOTS` restricts nested paths.
JSON-with-comments, YAML, Dockerfiles, shell and SQL are outside the gate.
The additional JSON diagnostics occur in:

- `.devcontainer/devcontainer.json`
- `packages/db/tsconfig.json` and `packages/db/tsconfig.build.json`
- `packages/ui/tsconfig.json` and `packages/ui/tsconfig.build.json`
- `turbo.json`

`.github/workflows/ci.yml` narrates prior PRs to explain a visible main-branch
filter. `.github/dependabot.yml` mixes compatibility constraints with incident
history. Docker/Compose files also contain long explanations outside the gate.
Extend coverage with syntax-aware readers and preserve parser directives,
shebangs, licenses and required machine annotations. Do not rewrite applied SQL
migrations merely to shorten comments.

### Dependency-version prose

The checker has no version rule; `scripts/check-comments.test.ts` explicitly
accepts `version 1.2.3` as a history near miss. Examples that still need cleanup:

- `vitest.config.ts`: named Vitest versions and change history.
- `packages/observability/src/otel-batch-timings.ts`: the SDK version beside the
  non-obvious constructor/environment limitation.
- `apps/api/src/features/responses/serve-step/schema.ts`: the Zod version beside
  the metadata-copy timing constraint.
- `apps/admin/components/questions/question-editor.tsx` and
  `apps/admin/e2e/questions-lifecycle.pw.ts`: the React version beside form-reset behavior.
- `pnpm-workspace.yaml` and static scaffold workspace YAML: pnpm versions in prose.

Keep the essential constraint without the version. Detection needs to distinguish
prose from machine directives: `v8 ignore` is a coverage directive, not a dependency
version to delete.

### Short comments still need semantic review

Length/history checks cannot establish necessity. For example,
`apps/portal/e2e/appearance.pw.ts` says "The truth about what is rendered" above
`liveMode`, adding nothing concrete to its name and DOM query. The composer helper
in `apps/admin/e2e/agent-assist.pw.ts` has a similar redundant description.
Ask what essential fact the name, types and implementation cannot communicate;
delete the comment if there is no answer.

### Stale live documentation

`docs/SECURITY_DESIGN.md` says the runtime Dockerfiles carry a `perl-base` upgrade
layer and a comment with its removal check. Neither exists in the audited tree;
the layer was already absent before the dependency repair. Reconcile that live
security description with the current Dockerfiles and image evidence rather than
adding an obsolete comment back.

## Reproduce the parser-based inventory

Run from the repository root in the supported Linux/WSL environment:

```sh
pnpm check:comments
node --input-type=module <<'JS'
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { scanText } from "./scripts/check-comments.mjs";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css|json|jsonc)$/.test(file))
  .filter((file) => !/^(plan\/|packages\/ui\/src\/components\/a2ui\/|packages\/create-qcms-app\/templates\/)/.test(file))
  .filter((file) => !/\.generated\.|__snapshots__\/|\.snap$/.test(file));
const hits = files.flatMap((file) => scanText(file, readFileSync(file, "utf8")));
for (const hit of hits) console.log(`${hit.file}:${hit.line} ${hit.rule}: ${hit.detail}`);
console.log(`${hits.length} diagnostics in ${new Set(hits.map((hit) => hit.file)).size} files`);
JS
```

These commands reproduce parser diagnostics, not the heuristic infrastructure
inventory or the semantic findings. Counts describe the audit snapshot and will
change as cleanup lands.
