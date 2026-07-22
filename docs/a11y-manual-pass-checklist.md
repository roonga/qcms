# Manual screen-reader pass - checklist and script

**Purpose:** the human-in-the-loop half of task 030 exit criterion 3. Automated
axe + Lighthouse (CI) catch roughly half of WCAG issues; this pass covers what
only a human with a screen reader can judge: does the flow actually make sense
when you cannot see it. An agent PREPARES this checklist; a person (Ravi or a
tester) EXECUTES it and records the result.

**Do not** let an automated tool or agent fill in the results below. The value is
a real person driving a real screen reader.

## How to run it

1. Copy this file to `docs/a11y-pass-<YYYY-MM-DD>.md` (today's date).
2. Fill in the environment table and work top to bottom, marking each check
   **pass / fail / n/a** and noting anything surprising.
3. File every failure as a GitHub issue with a severity (below) and link it in the
   Findings table. Fix or ticket before sign-off.
4. Sign and date the bottom. Exit criterion 3 is met when the log is committed
   with **zero open severity-1 (blocker)** issues.

**Severity:** S1 = blocks a screen-reader user from completing the flow or hides
essential information · S2 = completable but confusing / non-conforming · S3 =
minor polish.

### Run the portal for the manual pass

You need a real running portal serving a real published form. One command stands
up the whole stack (dev Postgres, the API, and the Next.js portal) and seeds and
publishes the kitchen-sink form, which exercises every question type plus two
branch rules:

```
pnpm dev:portal
```

It brings up the dev Postgres (`docker-compose.dev.yml`, `QCMS_DB_PORT=7020`),
migrates it, seeds + publishes `frm_kitchen_sink`, then starts the API and the
portal wired together and waits until both are healthy. Seeding is idempotent, so
re-running is safe. When it is ready it prints the respondent URL:

```
http://localhost:7000/f/kitchen-sink
```

Open that, click **Start**, and walk the flow. To stop, press **Ctrl+C** (stops
the API and portal); the Postgres container is left running. Remove it with:

```
docker compose -f docker-compose.dev.yml down
```

The `dev:portal` script generates the internal service token in memory per run
and never writes a secret to disk. Ports are overridable via env
(`QCMS_DEV_PORTAL_PORT`, `QCMS_DEV_API_PORT`, `QCMS_DB_PORT`) if 7000 / 7010 /
7020 are taken on your machine.

## Environment (fill in)

| Field | Value |
| --- | --- |
| Date | |
| Tester | |
| Portal build / commit | |
| Form under test (kitchen-sink) | |
| NVDA version + browser | NVDA \_\_\_ / Chromium \_\_\_ (Windows) |
| VoiceOver + browser | macOS \_\_\_ / Safari \_\_\_ |

Run the WHOLE table on **both** NVDA/Chromium and VoiceOver/Safari. Note the
screen reader in the Notes column when behavior differs between them.

## A. Entry and landmarks

| # | Check | NVDA | VO | Notes |
| --- | --- | --- | --- | --- |
| A1 | Page title / heading announced on load | | | |
| A2 | Skip link is the first focusable stop and moves focus to the content | | | |
| A3 | Landmarks (banner/header, main) are navigable and named | | | |
| A4 | Start control is reachable and its purpose is clear | | | |

## B. Every question type is operable

Drive each control **keyboard-only** while listening. The kitchen-sink form must
exercise every type; mark n/a only if the type is genuinely absent.

| # | Question type | Reaches / labelled | Value settable | State read back | Notes |
| --- | --- | --- | --- | --- | --- |
| B1 | Short text | | | | |
| B2 | Long text (textarea) | | | | |
| B3 | Number | | | | |
| B4 | Date | | | | |
| B5 | Boolean (yes/no radios) | | | | |
| B6 | Single choice (radio group) | | | | |
| B7 | Multi choice (checkbox group) | | | | |
| B8 | Select / dropdown | | | | |
| B9 | Required-question indication is announced (not colour-only) | | | | |

## C. Branch changes are perceivable

| # | Check | NVDA | VO | Notes |
| --- | --- | --- | --- | --- |
| C1 | Answering to INSERT a follow-up: the "N question(s) added" announcement is heard | | | |
| C2 | On insertion, focus stays on the control just answered (not yanked away) | | | |
| C3 | The inserted question is the next Tab stop and is fully operable | | | |
| C4 | Answering to REMOVE a follow-up: the "N question(s) removed" announcement is heard | | | |
| C5 | After a removal, focus is never lost to nowhere (lands on next question or heading) | | | |
| C6 | Step change (if multi-step) announces "Step N of M: {title}" | | | |

## D. Errors are discoverable (WCAG 3.3)

| # | Check | NVDA | VO | Notes |
| --- | --- | --- | --- | --- |
| D1 | Submitting with a missing required answer moves focus to the error summary and reads it | | | |
| D2 | Each summary entry is a link that jumps focus to the offending field | | | |
| D3 | The offending field's own error message is announced (aria-describedby) | | | |
| D4 | A server-rejected answer (invalid value) is announced at the field | | | |
| D5 | Nothing announces a stale error after it is corrected | | | |

## E. Completion

| # | Check | NVDA | VO | Notes |
| --- | --- | --- | --- | --- |
| E1 | Submission success is announced (the completion heading is read on load) | | | |
| E2 | The reference / receipt is reachable and readable | | | |

## F. Honeypot invisibility (026)

| # | Check | NVDA | VO | Notes |
| --- | --- | --- | --- | --- |
| F1 | Browsing by form field (NVDA `f` / VO form rotor) NEVER lands on the decoy `website` field | | | |
| F2 | Tabbing through the whole form never reaches the decoy | | | |
| F3 | The decoy is announced by neither screen reader in any navigation mode | | | |

## G. General AT experience

| # | Check | NVDA | VO | Notes |
| --- | --- | --- | --- | --- |
| G1 | No keyboard trap anywhere in the flow | | | |
| G2 | Focus order matches visual/reading order throughout | | | |
| G3 | The polite announcer does not over-talk (no repeated / stacked chatter) | | | |
| G4 | Reading the form with the virtual cursor makes sense end to end | | | |

## Findings

| ID | Check ref | Severity | Screen reader(s) | Description | Issue link | Status |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## Sign-off

- Open severity-1 (blocker) issues: **\_\_\_** (must be 0 to meet exit criterion 3)
- Result: PASS / FAIL
- Tester signature + date: **\_\_\_**
