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
  `389d02ce0629a3459b85596e244adf9c44ce5d32`
- **Previous pin**: `7347b3b9c8067869f5a0407ab490ef1c83814d53`
- **Captured**: 2026-09-10, the upstream pass carrying the `Menu` trigger and item slots
  (issue #234, upstream `roonga/a2-react-aria#75`)
- **Components installed**: alert, breadcrumb, button, card, checkbox, date-picker,
  dialog, form, layout, menu, number-field, radio, select, table, text, text-area,
  text-field

**The pin names an unmerged branch head, deliberately.** It is the head of upstream
`roonga/a2-react-aria#79`, the PR that lands the slots this change adopts. Merging
upstream is not this session's to do, so the pass was captured and gated against the
branch head rather than stopping short of the adoption. That repository squash-merges, so
this commit can never become `main` history: **when #79 merges, the pin moves to the squash
commit, the manifest is refreshed and this file's pin lines are re-taken.** The two commits
will be byte-identical over the vendored tree, so the re-pin rewrites no vendored byte and
the regenerated `a2ra-manifest.json` reproduces byte-for-byte apart from the recorded sha.
This is the same shape the previous two pin moves took, where `d34c9505` became `7347b3b9`
and `e4f8b36` became `075c3a9`.

A manifest generated at another commit is a hard failure of `check:a2ra-fidelity` rather
than a silent pass, so the pin, the manifest and the tree cannot drift apart quietly: the
re-pin and the refresh are one change.

## Which CLI, and why it is not `pnpm dlx`

The published CLI at `1.0.0-preview.4` **reports this tree as drifted when it is not**.
`diffLines` decided whether anything moved by scanning its own rendered output for the
substrings `"- "` and `"+ "`; those mark a removed or an added line, and they also occur
inside ordinary prose, so a component whose source carries a spaced hyphen diffs as
changed forever. The new `Menu` prop documentation is the first registry source to contain
one, so this pin is the first at which the bug is reachable, and the report it produces is
every line as context, no `-` and no `+` anywhere in it, and "Run `a2ra add <name>
--overwrite` to update" at the end - a red no overwrite can clear.

The fix is in the same upstream PR and therefore in the same pin
(`packages/cli/src/diff.ts`: the walk records that it emitted a removal or an addition at
the point it emits one). It is not published to npm yet, so the transcript below runs the
CLI **built from the sibling a2-react-aria checkout at this pin** rather than
`pnpm dlx @a2ra/cli`, written as `<cli>` in the console blocks. Both commands are otherwise
the ones the guidelines name. When a preview containing the fix is published, `pnpm dlx`
goes back to being the command.

`check:a2ra-fidelity` was never affected: it hashes bytes and never renders a diff.

## What moved, and the proof that nothing else did

A pin move re-vendors **every** component at once, so "only the intended fix changed" is
a claim about the whole tree rather than about the files that happen to be in the diff.
The new pin is two commits on top of the previous one, and the tree was diffed component
by component before the overwrite: `menu` drifted, and the other sixteen reported clean.

```console
$ pnpm dlx @a2ra/cli --version
1.0.0-preview.4

$ for c in alert breadcrumb button card checkbox date-picker dialog form layout \
>          number-field radio select table text text-area text-field; do
>   printf "%-14s " "$c"; pnpm dlx @a2ra/cli diff $c; done

alert          ✓ All installed components are up to date.
breadcrumb     ✓ All installed components are up to date.
button         ✓ All installed components are up to date.
card           ✓ All installed components are up to date.
checkbox       ✓ All installed components are up to date.
date-picker    ✓ All installed components are up to date.
dialog         ✓ All installed components are up to date.
form           ✓ All installed components are up to date.
layout         ✓ All installed components are up to date.
number-field   ✓ All installed components are up to date.
radio          ✓ All installed components are up to date.
select         ✓ All installed components are up to date.
table          ✓ All installed components are up to date.
text           ✓ All installed components are up to date.
text-area      ✓ All installed components are up to date.
text-field     ✓ All installed components are up to date.
```

Run `a2ra diff` with **one component named**, not bare: the bare form stops after the
first drifting file it finds, so it is a "something moved" signal rather than an
enumeration. That is why the sweep above is a loop.

This sweep predates the overwrite, so it ran against the OLD vendored bytes with the
published CLI. A clean verdict from it is trustworthy even with the bug above, because the
bug turns identical into drifted and never the other way round.

The one that drifted matches the upstream change exactly, and nothing else:

| Component | Files                                                              | Change                                                  | Issue           |
| --------- | ------------------------------------------------------------------ | ------------------------------------------------------- | --------------- |
| `menu`    | `Menu.tsx`, `index.ts`, `menu.schema.ts`, `menu.styles.ts`         | trigger, menu-label, header, class-name and item slots  | #234 / upstream #75 |

The second upstream commit in this pin (`fix(cli)`, above) touches `packages/cli` only,
which the registry does not ship, so it moves no vendored byte.

## The whole-tree overwrite

Every component was re-vendored from the new registry, not only the one that drifted, so
the tree is a copy of the pinned registry rather than the previous tree with four files
replaced.

```console
$ pnpm dlx @a2ra/cli add alert breadcrumb button card checkbox date-picker dialog form \
>   layout menu number-field radio select table text text-area text-field --overwrite

✓ Added 75 file(s) for alert, breadcrumb, button, card, checkbox, date-picker, dialog,
  form, layout, menu, number-field, radio, select, table, text, text-area, text-field.

$ git status --porcelain packages/ui/src
 M packages/ui/src/components/a2ui/menu/Menu.tsx
 M packages/ui/src/components/a2ui/menu/index.ts
 M packages/ui/src/components/a2ui/menu/menu.schema.ts
 M packages/ui/src/components/a2ui/menu/menu.styles.ts
```

Seventy-five files written, four changed. The count is one above the tree's 74 files
because `group-schema-fields.ts` is shipped by two items and written twice.

## The verdict

```console
$ node <cli> --version
1.0.0-preview.4

$ node <cli> diff

✓ All installed components are up to date.

$ node scripts/check-a2ra-fidelity.mjs
check-a2ra-fidelity: OK - 74 vendored files byte-identical to roonga/a2-react-aria @ 389d02ce0629 (ADR-22).
```

### And independently of the CLI, by git tree hash

The CLI compares text it fetched; a tree hash compares what git actually stored, on both
sides, with no fetch and no renderer in between. It is the check that would survive a
second CLI bug, so it is taken as well as the two above rather than instead of them: each
vendored component directory hashes to the identical tree object as upstream's own
directory at the pin.

```console
$ for c in alert breadcrumb button card checkbox date-picker dialog form layout menu \
>          number-field radio select table text text-area text-field; do
>   up=$(git -C <sibling a2-react-aria checkout> rev-parse 389d02ce:packages/core/src/components/$c)
>   here=$(git write-tree --prefix=packages/ui/src/components/a2ui/$c)
>   [ "$up" = "$here" ] && printf "%-14s identical %s\n" "$c" "$up" || printf "%-14s DIFFERENT\n" "$c"
> done

alert          identical 1ae9ab7abf9f1d0935837cbf76877343a2c182b0
breadcrumb     identical d813cfae50df4d5e42c63f37f6dceb694fce08cb
button         identical 93e810d3f911c8406217381924fb64b78065a227
card           identical 26634d3afcec3b8aa250ae7d856dc030ed532b38
checkbox       identical df7eb17890cd2e249585b47a47a0e9ceff8b1c7f
date-picker    identical e639576c1dfe3c7e8abf68b7e8c4c20c5d38abeb
dialog         identical 12e4e6a9250154369232a82dc20576bb7ab6f5d3
form           identical eb4702ca0210fbd058a11d4ddcd230aee46a85f6
layout         identical 0e60e409782f2dc7059a48a9d2e3437486a3dd26
menu           identical 91e19a062e319aa712d5c4f0ac0e26c5d3a64a43
number-field   identical e06ada48523542ad405cb6d94d079f9d48f3dc49
radio          identical 55c60e97c67c855c553d64e423d544b87840ccb7
select         identical 838f3108d76d86ecce9ec1f3e5219db7d6847a91
table          identical bdf1558b87c2a158c05135f0a8f73358336a0e78
text           identical 077dab7f4366d11e24fb2a0d80decb80839f3279
text-area      identical f3ae6b65d69b13f41c4af59faf96ee282e929619
text-field     identical b3dd2e05fd3ac7f44f0a4e2f9ee7ae2f647b25d2

# and the one file that belongs to no component directory
group-schema-fields.ts identical 4308f0ed403e53879b312013b8534ddcba54ecc1
```

A tree object hashes the names, modes and blob contents of everything under it, so an
identical tree sha means an identical set of files with identical bytes. Nothing about the
comparison depends on the registry, the network, or the CLI. The GitHub compare API is
deliberately not used for this: it answers a question about two commits, not about whether
one directory in this repository equals one directory in another.

## The negative control

A clean verdict from a gate that has never failed in front of you is a hypothesis, not a
control (055's retro lesson, applied here). One byte was appended to a vendored file, both
checks were re-run, and the file was restored - so the lines above are known to mean
"identical" rather than "not checked".

The control is taken on `menu/Menu.tsx`, the file this pass changed and the one carrying
the new slots: a control on an untouched file would prove the harness works without
proving it works on the bytes under review.

Context lines are elided where marked; nothing else is edited.

```console
$ printf "\n" >> src/components/a2ui/menu/Menu.tsx   # deliberate one-byte drift

$ node <cli> diff menu

── menu/Menu.tsx ──

[... 240 unchanged context lines elided ...]

  			</Popover>
  		</MenuTrigger>
  	)
  }
  
-

Run `a2ra add <name> --overwrite` to update.

$ node scripts/check-a2ra-fidelity.mjs
check-a2ra-fidelity: the vendored tree is not the pinned upstream tree (ADR-22):

  changed (content differs from upstream at the pin):
    menu/Menu.tsx  (upstream 675e8457c374, here f3f0b5793fb1)
exit=1

$ node <cli> add menu --overwrite   # restore from the registry

✓ Added 4 file(s) for menu.

$ node <cli> diff

✓ All installed components are up to date.

$ node scripts/check-a2ra-fidelity.mjs
check-a2ra-fidelity: OK - 74 vendored files byte-identical to roonga/a2-react-aria @ 389d02ce0629 (ADR-22).
exit=0
```

The trailing `-` line is the removed byte: the appended newline, reported as a line the
registry does not have. Both checks went red and then green on the same byte, which is
what makes them a pair rather than one gate and one echo of it. Note the restore is
`add --overwrite`, not `git checkout --`: at the moment the control was taken the
re-vendored files were uncommitted, so a checkout would have restored the files from the
OLD pin and left the tree quietly stale.
