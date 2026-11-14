---
name: decide
description: Ask the Code Owner every pending QCMS decision one at a time, or say there is nothing to decide. Use when the Code Owner says "/decide", "anything to decide" or "what do you need from me".
---

Collect open decisions, then ask them one by one. Never answer a question on the Code Owner's behalf.

1. Gather open decisions from `origin/main`, GitHub and this session, not memory alone:
   - `HANDOFF.md` on open `feat/*` and `fix/*` branches whose first line is `HANDOFF: AWAITING-HUMAN`.
   - Open PRs and issues with an unanswered question addressed to the Code Owner, or labelled for a Code Owner decision.
   - Work orders in the ledger (`docs/features/README.md`) whose next step is blocked on a named human gate.
   - Questions raised earlier in this session that were never answered (offers, rulings, follow-ups).
2. If there are none, reply with one line: `Nothing to decide.`
3. Otherwise, say how many there are, then ask the first one with `AskUserQuestion`:
   - one question per call, written so it stands on its own: what it is about, why it is needed, and what it blocks;
   - 2 to 4 options, recommended first, marked `(Recommended)`;
   - no task, PR or issue numbers unless needed to tell items apart.
4. After each answer, record it where it belongs: the PR or issue comment, `HANDOFF.md`, or the decision record. Act on it only where the Code Owner's answer says to, then ask the next question.
5. End with one short list: each decision and its answer.
