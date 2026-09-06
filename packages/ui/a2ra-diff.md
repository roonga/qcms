# Vendoring fidelity transcript (`a2ra diff`)

`docs/COMPONENT_GUIDELINES.md` step 1: vendored sources under `src/components/a2ui/**`
stay byte-identical to the pinned registry, and **fidelity is provable only by
`a2ra diff`** - so its transcript is committed with the change rather than asserted in a
PR body. Task 028's retro (`docs/RETRO.md`) recorded the absence of this file as a
reviewer friction; task 032 is where it starts existing.

Refresh this file whenever `a2ra.json`'s pin moves or a component is added, overwritten
or upgraded. It is evidence, not configuration: nothing reads it.

**Since issue #189 it is no longer the only evidence.** `pnpm check:a2ra-fidelity` compares
every file in the vendored tree against `packages/ui/a2ra-manifest.json`, a record of
upstream's own content at the pinned commit, and runs inside `pnpm verify` and CI without
touching the network. Refresh the manifest in the same change as this transcript
(`node scripts/check-a2ra-fidelity.mjs --refresh`). The two are not redundant: the gate
answers "do the bytes still match" on every run, and this file answers "what moved at the
pin, and what did a human check" once per pin move.

- **Registry pin** (`a2ra.json`): `roonga/a2-react-aria` @
  `7347b3b9c8067869f5a0407ab490ef1c83814d53`
- **Previous pin**: `075c3a9324e146a4701d1c47a5cfcc0afccc2f7b`
- **Captured**: 2026-09-06, the upstream pass carrying issues #804, #789 and #793
- **Components installed**: alert, breadcrumb, button, card, checkbox, date-picker,
  dialog, form, layout, menu, number-field, radio, select, table, text, text-area,
  text-field

**The pin names upstream `main`. It briefly named `d34c9505`**, the branch commit of
roonga/a2-react-aria#78, because the upstream change was not merged yet: the merge action
was refused by this session's permission system, so the pass stopped short of it rather
than working around it, and the work below was captured and gated against the branch head.
That repository squash-merges, so the branch commit could never become `main` history: the
merge landed its content as `7347b3b9`, and the pin moved to it. The two commits are
byte-identical over the whole tree (`git diff d34c9505 7347b3b9` is empty), which is why
the re-pin rewrites no vendored byte and the regenerated `a2ra-manifest.json` reproduces
byte-for-byte apart from the recorded sha. This is the same shape as the previous pin move,
where `e4f8b36` became `075c3a9`.

A manifest generated at another commit is a hard failure of `check:a2ra-fidelity` rather
than a silent pass, so the pin, the manifest and the tree cannot drift apart quietly: the
re-pin and the refresh are one change.

## What moved, and the proof that nothing else did

A pin move re-vendors **every** component at once, so "only the intended fix changed" is
a claim about the whole tree rather than about the files that happen to be in the diff.
The new pin is a single commit on top of the previous one, and it was diffed component
by component before the overwrite: `checkbox`, `number-field` and `text-field` drifted,
and the other fourteen reported clean.

```console
$ pnpm dlx @a2ra/cli --version
1.0.0-preview.4

$ for c in alert breadcrumb button card date-picker dialog form layout menu \
>          radio select table text text-area; do
>   printf "%-14s " "$c"; pnpm dlx @a2ra/cli diff $c; done

alert          ✓ All installed components are up to date.
breadcrumb     ✓ All installed components are up to date.
button         ✓ All installed components are up to date.
card           ✓ All installed components are up to date.
date-picker    ✓ All installed components are up to date.
dialog         ✓ All installed components are up to date.
form           ✓ All installed components are up to date.
layout         ✓ All installed components are up to date.
menu           ✓ All installed components are up to date.
radio          ✓ All installed components are up to date.
select         ✓ All installed components are up to date.
table          ✓ All installed components are up to date.
text           ✓ All installed components are up to date.
text-area      ✓ All installed components are up to date.
```

Run `a2ra diff` with **one component named**, not bare: the bare form stops after the
first drifting file it finds, so it is a "something moved" signal rather than an
enumeration. That is why the sweep above is a loop.

The three that drifted match the three upstream component fixes exactly, and nothing else:

| Component      | File              | Change                                                 | Issue |
| -------------- | ----------------- | ------------------------------------------------------ | ----- |
| `text-field`   | `TextField.tsx`   | seeds its initial value from the server-rendered input | #804  |
| `number-field` | `NumberField.tsx` | `aria-hidden="true"` on the required marker            | #789  |
| `checkbox`     | `Checkbox.tsx`    | `isRequired` no longer defaults to `false`             | #789  |

The fourth upstream change (#793) moves no component source at all: it teaches upstream's
registry generator to follow a component's imports out of its own directory, so
`group-schema-fields.ts` is now shipped by the `checkbox` and `radio` items instead of
belonging to none. The vendored bytes are unchanged, which is why `radio` reports clean
above; what changes here is the manifest, where that file's `origin` moves from
`repo:packages/core/src/components/group-schema-fields.ts` to `registry:checkbox`, and
`scripts/check-a2ra-fidelity.mjs`, whose `UPSTREAM_REPO_SOURCES` mapping is now empty.

## The whole-tree overwrite

Every component was re-vendored from the new registry, not only the three that drifted, so
the tree is a copy of the pinned registry rather than the previous tree with three files
replaced.

```console
$ pnpm dlx @a2ra/cli add alert breadcrumb button card checkbox date-picker dialog form \
>   layout menu number-field radio select table text text-area text-field --overwrite

✓ Added 75 file(s) for alert, breadcrumb, button, card, checkbox, date-picker, dialog,
  form, layout, menu, number-field, radio, select, table, text, text-area, text-field.

$ git status --porcelain packages/ui/src
 M packages/ui/src/components/a2ui/checkbox/Checkbox.tsx
 M packages/ui/src/components/a2ui/number-field/NumberField.tsx
 M packages/ui/src/components/a2ui/text-field/TextField.tsx
```

Seventy-five files written, three changed. The count is one above the tree's 74 files
because `group-schema-fields.ts` is now shipped by two items and written twice.

## The verdict

```console
$ pnpm dlx @a2ra/cli --version
1.0.0-preview.4

$ pnpm dlx @a2ra/cli diff

✓ All installed components are up to date.

$ node scripts/check-a2ra-fidelity.mjs
check-a2ra-fidelity: OK - 74 vendored files byte-identical to roonga/a2-react-aria @ 7347b3b9c806 (ADR-22).
```

Re-taken at the merged pin rather than carried over from the branch pin, so the line above
is what this pin produces. The whole-component sweep and the negative control below were
captured against `d34c9505` and are not re-transcribed: the two commits are byte-identical,
and the gate line above is the check that says so at the pin actually recorded.

## The negative control

A clean verdict from a gate that has never failed in front of you is a hypothesis, not a
control (055's retro lesson, applied here). One byte was appended to a vendored file, the
diff was re-run, and the file was restored - so the line above is known to mean
"identical" rather than "not checked".

The control is taken on `text-field/TextField.tsx`, one of the three files this pass
changed and the one carrying the #804 fix: a control on an untouched file would prove the
harness works without proving it works on the bytes under review.

Context lines are elided where marked; nothing else is edited.

```console
$ printf "\n" >> src/components/a2ui/text-field/TextField.tsx   # deliberate one-byte drift

$ pnpm dlx @a2ra/cli diff text-field

── text-field/TextField.tsx ──
  import { useContext, useEffect, useId, useState, useSyncExternalStore } from "react"

[... 150 unchanged context lines elided ...]

  		</RACTextField>
  	)
  }

-

Run `a2ra add <name> --overwrite` to update.

$ pnpm dlx @a2ra/cli add text-field --overwrite   # restore from the registry

✓ Added 4 file(s) for text-field.

$ pnpm dlx @a2ra/cli diff

✓ All installed components are up to date.
```

The trailing `-` line is the removed byte: the appended newline, reported as a line the
registry does not have. Note the restore is `add --overwrite`, not `git checkout --`: at
the moment the control was taken the re-vendored files were uncommitted, so a checkout
would have restored the files from the OLD pin and left the tree quietly stale.
