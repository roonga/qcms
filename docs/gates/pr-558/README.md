# Gate: issue 558, the width cap becomes per-route

**What to approve:** that the seven screens whose measure changed look right at their new
cap, and that nothing else moved. The shell's content column no longer takes one global
`max-w-5xl`; it takes the cap its route asks for, from the table in
`apps/admin/lib/measure.ts`. `plan/admin-ux-audit.md` section 6 assigns the three values.

Every frame is committed as a **pair**: `before/<name>-<width>.png` is the same spec run
against the parent state (`app/(shell)/layout.tsx` and `app/globals.css` restored to
`fix/557-breakpoint-tokens`, and `lib/measure.ts` / `components/measured-main.tsx` absent),
`<name>-<width>.png` is the branch. A cap is only visible as a difference, so a lone after
frame would show nothing.

## The three measures

| Measure  | Value          | Where the number comes from                                        |
| -------- | -------------- | ------------------------------------------------------------------ |
| wide     | 100rem, 1600px | the POCs' own `.main { max-width: 1600px }`                         |
| default  | 64rem, 1024px  | unchanged, Tailwind's `--container-5xl`, the app's cap until now    |
| narrow   | 45rem, 720px   | the portal's respondent measure (42rem) plus the shell's `p-6` (3rem) |

## The frames, and the clause each one satisfies

Five screens **earn width** (section 6, "genuinely earn width"). Compare the 1280 pair: the
content column goes from 1024px to the full viewport.

| Frame               | Screen                          | Clause                                                       |
| ------------------- | ------------------------------- | ------------------------------------------------------------ |
| `form-builder`      | `/forms/[formId]`               | already carries the app's only responsive utilities          |
| `form-links`        | `/forms/[formId]/links`         | seven columns, four of them timestamps                       |
| `form-versions`     | `/forms/[formId]/versions`      | five monospace stamp columns                                 |
| `form-webhooks`     | `/forms/[formId]/webhooks`      | two wide tables stacked, one of seven columns with a URL     |
| `webhooks`          | `/webhooks`                     | six columns including a URL and a free-text `lastError`      |

Two screens **go narrower**, and section 3.4 makes that a correctness question rather than a
taste one: both render respondent-facing content through the shared renderer, and an author
judging line length under a 1600px admin container is judging something no respondent will
ever see.

| Frame            | Screen                               | Clause                                       |
| ---------------- | ------------------------------------ | -------------------------------------------- |
| `form-preview`   | `/forms/[formId]/preview`            | inherits the respondent's measure, not the admin's |
| `version-detail` | `/forms/[formId]/versions/[version]` | same, for the published-version render       |

Both widths are committed for every pair. The **390px** frames are the "nothing moved on a
phone" half: a cap is fluid below itself, so all three measures render identically there and
each 390 pair is byte-identical.

The other eight screens keep the measure they had, and their pairs are committed too. There
is nothing to look at in them, and that is the point: they are here so the digest table can
be re-run against the repository rather than taken on trust.

| Frame             | Screen                        |
| ----------------- | ----------------------------- |
| `forms`           | `/forms`                      |
| `form-responses`  | `/forms/[formId]/responses`   |
| `questions`       | `/questions`                  |
| `question-new`    | `/questions/new`              |
| `question-detail` | `/questions/[questionId]`     |
| `responses`       | `/responses`                  |
| `erasures`        | `/responses/erasures`         |
| `settings`        | `/settings`                   |

## Nine screens render byte-identically, and here is the proof

`byte-identity.txt` beside this file is a sha256 comparison of the whole sweep, before
against after, at both widths. Two identical PNGs look exactly like two nearly-identical
ones, so the evidence for the unchanged screens is the digest table rather than a frame to
squint at. **23 of the 30 pairs are the same bytes:** all sixteen frames at 390, and at 1280
exactly the eight unchanged screens. The seven that differ at 1280 are the seven this issue
moves, and no others.

To re-run it:

```
cd docs/gates/pr-558 && for f in *.png; do
  [ "$(sha256sum <"$f")" = "$(sha256sum <"before/$f")" ] && echo "same $f" || echo "diff $f"
done
```

`/forms/[formId]/responses/[sessionId]` is the one authenticated screen absent from the
sweep. Its subject is a session created at run time, so its content differs between the
before run and the after run for reasons that have nothing to do with a cap, and a byte
comparison of it would mean nothing. It is covered instead by `apps/admin/e2e/measure.pw.ts`,
which does create a response and asserts that route's column measures 1024px and that its
`<main>` carries the exact class attribute it carried before.

## How the frames were made

```
QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
  --project=admin-chromium apps/admin/e2e/gate-558.pw.ts
```

Dev chrome hidden, full page, caret suppressed, and every frame taken from a fresh load at
its own viewport rather than by resizing a live page (the builder sits in a `container-type:
inline-size` context whose query resolves after a resize, not during it). No response is
submitted, so every frame's content comes from the seeded fixture alone.

The blank line at the bottom of every frame, and a second one in the Settings account card,
is the signed-in operator's address, hidden. It is the one string on these screens that
cannot repeat between two runs: the suite mints its admin account per run, and the shell
footer prints that address on every authenticated screen. Left visible it makes every pair
differ for a reason that has nothing to do with a width cap, and the byte comparison then
says nothing. It was found by comparing an unhidden sweep and pixel-diffing the frames that
disagreed, not guessed at, and it is hidden with `visibility: hidden` so the line keeps its
box and no geometry moves.

## The other logs here

- `red-first-unit.txt` - `lib/measure.test.ts` against a stub that reproduces the old
  behaviour, one global cap and no table: 5 failed, 4 passed.
- `red-first-e2e.txt` - `measure.pw.ts` against the parent state: exactly seven routes
  report a 1024px cap where the table asks for 1600 or 720, and the nine unchanged ones
  pass, class attribute included.

## The measured widths, for the record

Taken by `apps/admin/e2e/measure.pw.ts` at a 1280px viewport, as the content column's own
box. The wide screens are viewport-limited there, not cap-limited: their 1600px cap only
fills at a wider display.

| Screen                               | Before | After |
| ------------------------------------ | ------ | ----- |
| `/forms/[formId]`                    | 1024   | 1280  |
| `/forms/[formId]/links`              | 1024   | 1280  |
| `/forms/[formId]/versions`           | 1024   | 1280  |
| `/forms/[formId]/webhooks`           | 1024   | 1280  |
| `/webhooks`                          | 1024   | 1280  |
| `/forms/[formId]/preview`            | 1024   | 720   |
| `/forms/[formId]/versions/[version]` | 1024   | 720   |
| the other nine                       | 1024   | 1024  |

At 390 every one of the sixteen measures 390, before and after.
