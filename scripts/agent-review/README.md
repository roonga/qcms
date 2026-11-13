# Assistant review

Scenarios, a rubric and deterministic checks for reviewing the admin authoring assistant. On demand only: a run needs a real model key on the API and costs money, so nothing here is in CI. `docs/DEVELOPER_GUIDE.md` has the operator's version, and `.claude/skills/review-assistant/` is the agent's.

| File               | What it is                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `scenarios/*.json` | One conversation each, runnable by `pnpm agent:converse --script`, with a budget and an expected end state. |
| `rubric.md`        | What a reviewer judges a transcript against. A line marked **auto** has a check behind it.                  |
| `terms.mjs`        | The words the assistant may not say, and the branded id patterns.                                           |
| `checks.mjs`       | The deterministic half, over a transcript. Also a command line.                                             |
| `end-state.mjs`    | Reads back the forms, versions, links and rules a run left behind.                                          |
| `fixtures/*.json`  | Two transcripts the tests run against: the session this was built for, and a clean one.                     |

```sh
# One scenario, against a running admin with a model key on its API.
pnpm agent:converse --script scripts/agent-review/scenarios/02-publish-and-test-link.json

# What the run left behind, and the checks over both.
node scripts/agent-review/end-state.mjs --environment test --out "$(node scripts/agent-scratch.mjs end-state.json)"
node scripts/agent-review/checks.mjs \
  scripts/agent-review/scenarios/02-publish-and-test-link.json \
  "$(node scripts/agent-scratch.mjs agent-review-02-publish-and-test-link)/transcript.json" \
  "$(node scripts/agent-scratch.mjs end-state.json)"
```

Exit 0 is a pass, 1 is a finding, 2 is a usage or credential problem. The checks and the end-state reader run under `pnpm verify` against the committed fixtures, with no stack and no key.

Every scenario invents its data. No scenario sends a real person's details, and a scenario's end state is read back from the API rather than taken from what the assistant said.
