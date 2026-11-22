# Assistant review

Scenarios, a rubric and deterministic checks for reviewing the admin authoring assistant. On demand only: a run needs a real model key on the API and costs money, so nothing here is in CI. `docs/DEVELOPER_GUIDE.md` has the operator's version, and `.claude/skills/review-assistant/` is the agent's.

| File               | What it is                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `scenarios/*.json` | One conversation each, runnable by `pnpm agent:converse --script`, with a budget and an expected end state. |
| `rubric.md`        | What a reviewer judges a transcript against. A line marked **auto** has a check behind it.                  |
| `terms.mjs`        | The words the assistant may not say, and the branded id patterns.                                           |
| `checks.mjs`       | The deterministic half, over a transcript. Also a command line.                                             |
| `end-state.mjs`    | Reads back the forms, versions, links, rules and question settings a run left behind.                       |
| `eval-status.mjs`  | The run's live status file: creates one, patches a scenario, validates the shape. Also a command line.      |
| `fixtures/*.json`  | Transcripts the tests run against: the session this was built for, a clean one, and a set of openers.       |

```sh
# One scenario, against a running admin with a model key on its API.
pnpm agent:converse --script scripts/agent-review/scenarios/02-publish-and-test-link.json

# What the run left behind, and the checks over both.
node scripts/agent-review/end-state.mjs --out "$(node scripts/agent-scratch.mjs end-state.json)"
node scripts/agent-review/checks.mjs \
  scripts/agent-review/scenarios/02-publish-and-test-link.json \
  "$(node scripts/agent-scratch.mjs agent-review-02-publish-and-test-link)/transcript.json" \
  "$(node scripts/agent-scratch.mjs end-state.json)" \
  --before "$(node scripts/agent-scratch.mjs before-02.json)"
```

`--before` takes an end state read _before_ the scenario ran, which is what the scenario's
`seed.expect` is checked against. Reading one is optional; without it a chain run out of
order shows up later, as end-state findings that do not say why.

Exit 0 is a pass, 1 is a finding, 2 is a usage or credential problem. The checks and the end-state reader run under `pnpm verify` against the committed fixtures, with no stack and no key.

A run keeps `eval-status.json` beside those files, in the same lane scratch directory, so a monitor can follow it while it is still going:

```sh
status="$(node scripts/agent-scratch.mjs eval-status.json --fresh)"
node scripts/agent-review/eval-status.mjs init "$status" '{ "runId": "eval-2026-01-01",
  "stack": { "adminUrl": "http://localhost:7040" },
  "scenarios": [{ "id": "publish-and-test-link", "title": "Publish and a test link", "budget": 3 }] }'
node scripts/agent-review/eval-status.mjs set "$status" publish-and-test-link '{ "state": "running" }'
```

Each write replaces the whole file through a rename, so a reader never catches half of one, and the shape is validated before it lands. It holds no credential, no address and no transcript text beyond a check's own short message.

A scenario's `seed.reset` is `fresh` or `after:<id>`. `fresh` is `QCMS_PORT_SEAT=<0-9> pnpm
dev:fresh`, which takes this seat's stack down with its database and brings it back: one
named command, rather than a lane dropping a Docker volume by hand. `seed.requires` is the
prose beside it, and `seed.expect` is the half the checks read.

**The chain starting from `publish-and-test-link` runs in one order, and the counts are
written for it:**

1. `publish-and-test-link`, which leaves the form on test with one link
2. `why-did-you-stop`
3. `ambiguous-request`
4. `production-release`
5. `a-step-that-fails`
6. `did-you-create-a-link`, the one that adds the second link
7. `change-a-published-rule`, the one that changes the form, so it goes last

A scenario run out of that order fails on a link count rather than on the assistant, which is
what happened the first time `a-step-that-fails` created a link of its own.

A turn's own reply is read before its card directive is applied, because a plan marked
`thenAnother` is answered by a turn nobody typed and a later read would record that one's words
as this turn's. The run waits for that follow-up before sending the next message, and records it
beside the reply it followed as `followUpReply` and `followUpSteps`; `checks.mjs` reads both
halves wherever it reads what the assistant said.

Every scenario invents its data. No scenario sends a real person's details, and a scenario's end state is read back from the API rather than taken from what the assistant said.

A scenario names the environment its screen is set to, and a message may name how many
cards that turn should put up: `"expectCards": 0` makes a card a finding where the right
answer is a question, and `"expectCards": 1` makes a refusal one where the signed-in person
holds the grant. A message naming no count asserts nothing about its turn, which is what a
turn whose plan is marked `thenAnother` wants: the follow-up's own card is read as part of
that turn, so a count written for the first card alone would fail on the second.

The end state is read in every environment an installation has, not only the one the run
acted in, because "not released to prod" read from `test` alone says nothing. Name a
narrower set with `--environment test` or `--environment test,prod`; the first one named is
where the form list and the question library are read.

A scenario may assert one question's settings as well as the form's shape: `required`, `optionCount`, `dateMin`, `dateMax`, `pattern`, `minSelected` and `maxSelected`, each naming the question by a substring of its label. `notAfter` and `notBefore` take a literal date or `today`, which resolves to the day the end state was read rather than the day the checks run. A setting that was never set reads as absent, which is what makes "the date of birth accepts the year 2100" a failure rather than a judgement call.
