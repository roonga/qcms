---
name: review-assistant
description: Run chosen assistant scenarios against a local stack, apply the deterministic checks, and dispatch report-only reviewers to produce one findings report. On demand only; it needs a real model key and costs money, so it is never a gate.
---

Review the admin authoring assistant against `scripts/agent-review/scenarios/` and `scripts/agent-review/rubric.md`. The conductor coordinates; reviewers report and never edit.

**This is on demand, not CI.** A run spends a real model key (`QCMS_AGENT_API_KEY` on the API) and real tokens on the reviewers, so it runs when someone asks for it and never from a gate. Only the Vitest half (`scripts/agent-review/*.test.ts`) belongs to `pnpm verify`.

**The Code Owner approves every change this produces to the assistant prompt (`apps/api/src/features/agent/system-prompt.ts`), to tool descriptions, and to anything in `docs/adr` or `docs/agent-principle.md`.** This skill proposes; it does not land prompt changes.

1. **Pre-flight.** Read `PROJECT_INSTRUCTIONS.md`, `docs/agent-principle.md`, `scripts/agent-review/rubric.md` and the scenarios you were asked for. Write every log, transcript and report under this lane's own directory from `node scripts/agent-scratch.mjs`, never the shared scratchpad root, and never read a gate result back from a path you did not create in the same command that wrote it (issues #396, #602). Then open the run's status file, `eval-status.json` in that same directory, with every scenario `queued`:

   ```sh
   status="$(node scripts/agent-scratch.mjs eval-status.json --fresh)"
   node scripts/agent-review/eval-status.mjs init "$status" '{
     "runId": "eval-2026-01-01", "stack": { "adminUrl": "http://localhost:7340", "headSha": "abcdef1" },
     "scenarios": [{ "id": "new-patient-form", "title": "A new patient form", "budget": 2 }] }'
   ```

   **Keep it current after every state change**, because a monitor reads it while the run is still going: `node scripts/agent-review/eval-status.mjs set "$status" <scenario> '<patch>'`. The states are `queued`, `running`, `run`, `checked`, `reviewing`, `reviewed` and `not-run`, and each step below says which one it leaves behind. Nothing goes in that file but the shape `scripts/agent-review/eval-status.mjs` validates: no credential, no address, no transcript text beyond a check's own short message.

2. **Stand the stack up.** A `next dev` admin from this worktree on `http://localhost:7040`, its API reachable on `127.0.0.1:7010` and already holding the model key (`QCMS_AGENT_API_KEY`), and `QCMS_INTERNAL_TOKEN` exported **before** the stack starts: `scripts/dev-stack.mjs` generates a random one otherwise and writes it nowhere. Credentials come from the environment only, never a flag and never a file in the checkout. Print no secret, quote no secret into a report, and copy nothing out of a run's owner-only `secrets.json`.
3. **Reset to the scenario's starting point.** Each scenario's `seed.reset` is either `fresh` or `after:<id>`. `fresh` means a database with none of the scenario's fake data in it; `after:<id>` means run that scenario first and start from what it left. There is no reset endpoint, so a `fresh` start is a new dev database (`pnpm dev:down && pnpm dev:up`, or dropping the dev Postgres volume for a hand-run stack) followed by the admin account steps. Run the scenarios of one chain in order, in one lane.
4. **Run each scenario.** Set it `running` first, then `pnpm agent:converse --script scripts/agent-review/scenarios/<file>.json`, which writes `transcript.json` and `turn-NN.png` under the run's scratch directory. A scenario with `"mode": "simulated"` carries a `brief` instead of a full script: play the person from that brief with a **Sonnet** subagent, one turn at a time, sending each turn with `--ask` and stopping at the scenario's budget. Never invent a detail the brief does not give, and never use product vocabulary the brief does not use. Leave it `run` with the turns it took: `set "$status" new-patient-form '{ "state": "run", "turns": 2 }'`.
5. **Read the end state back.** `node scripts/agent-review/end-state.mjs --environment test --out <scratch>/end-state.json`, with `QCMS_AGENT_REVIEW_SESSION` holding an admin session token. Judge the end state on that file, never on what the assistant said it did.
6. **Run the deterministic checks.** `node scripts/agent-review/checks.mjs <scenario> <transcript> <end-state>` per scenario. Exit 0 passes, 1 has findings, 2 is a usage or credential problem. These are mechanical: a **Sonnet** subagent runs them and reports the output verbatim. Leave the scenario `checked`, carrying the exit code and one short entry per finding: `'{ "state": "checked", "checks": { "exit": 1, "findings": [{ "id": "budget", "severity": "fail", "text": "four turns against a budget of three" }] } }'`.
7. **Dispatch one reviewer per scenario, in parallel.** Set each `reviewing` as it goes out. Each gets the scenario file, its transcript, its screenshots, its check output and `rubric.md`, and is told to report only: a reviewer never edits the branch, never reruns the scenario and never changes a scenario file. Use **Opus** for review. Use **Fable** only for a design call the Code Owner will rule on, and say in the brief that it is that kind of call. Tell each reviewer to open the screenshots with the Read tool before writing a word about layout (`docs/DEVELOPER_GUIDE.md`, "Looking at a committed PNG before writing prose about it"). A verdict that comes back leaves the scenario `reviewed`, with `pass`, `fail` or `mixed` and the findings by kind.
8. **Write one report** under this lane's scratch directory. Short, in the repository's written style: per-scenario pass or fail with its turn count, then the findings grouped by kind, each with one evidence quote and one suggested change.
   - `prompt`: the assistant's guidance is wrong, missing or contradicted.
   - `tool-description`: a tool's own description misled the model.
   - `interface-wording`: a string the product owns reads badly.
   - `layout`: spacing, order, focus, contrast, status markers.
   - `missing-capability`: the right answer needs something the assistant cannot do yet.

   Quote no secret and no link address. A finding that cannot carry its evidence without one says so instead.

9. **Hand the findings over.** Open issues or a work order for what is agreed; take prompt, tool-description and ADR findings to the Code Owner with the evidence rather than landing them. Never edit `apps/api/src/features/agent/system-prompt.ts` from this skill.

A scenario whose stack never came up is reported as not run, not as a pass: `'{ "state": "not-run", "note": "the admin never came up" }'`, and the same for a step the permission system refuses. A reviewer's verdict is about the transcript it was given and goes stale the moment the prompt changes.

The finding kinds in the status file are the five above, spelled `prompt`, `tool description`, `interface wording`, `layout` and `missing capability`.
