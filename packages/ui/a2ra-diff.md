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
  `d1677b6607844433cf09772aadadea09ae888392`
- **Previous pin**: `009d44710bedef57324e216192d167e578b4e9de`
- **Captured**: 2026-09-12, re-taken at the squash commit of upstream
  `roonga/a2-react-aria#81`, the pass making `react-aria-components` a peer dependency of
  `@a2ra/core` (issue #151, upstream issue `roonga/a2-react-aria#80`)
- **Components installed**: alert, breadcrumb, button, card, checkbox, date-picker,
  dialog, form, layout, menu, number-field, radio, select, table, text, text-area,
  text-field

## The pin names upstream `main`, and this one moves no vendored byte at all

`d1677b66` is the squash commit of upstream `roonga/a2-react-aria#81`, on upstream `main`.
**This is the final pin for this change**, and the provisional pin this file named during
the review (`27091f57`, the pull request's branch head) is history rather than
configuration now. Upstream squash-merges, so a branch head can never become `main`
history and a QCMS branch that adopts one has to name a commit that will be thrown away;
the route is the same one the `009d4471` capture describes, and it is walked here for the
second time.

| Pin        | What it was                          | Why it moved                 |
| ---------- | ------------------------------------ | ---------------------------- |
| `27091f57` | provisional capture, the branch head | upstream `#81` squash-merged |
| `d1677b66` | the squash commit, upstream `main`   | final                        |

What is different from the previous pass is that this one changes **nothing under
`registry/`**. Upstream `#81` edits `packages/core/package.json` (moving one dependency to
`peerDependencies`), its lockfile and a changeset, and no component source. So the vendored
tree at this pin is the vendored tree at the last two, and the whole of the fidelity work
below is a demonstration of that rather than a record of a change.

That is checkable without trusting the sentence. Against the **previous merged pin** it is
checked on the registry directory rather than the whole repository, because the whole
repository is exactly what did move; against the **reviewed provisional pin** the whole
repository is identical, which is the thing a re-take at a squash commit has to demonstrate
rather than assert.

```console
$ git -C <sibling a2-react-aria checkout> rev-parse 009d4471:registry
8b277709c32c08fc01c7dc714739a8698260744c

$ git -C <sibling a2-react-aria checkout> rev-parse d1677b66:registry
8b277709c32c08fc01c7dc714739a8698260744c

$ git -C <sibling a2-react-aria checkout> rev-parse 009d4471:packages/core/src/components
1a455aab73a82ba039b3a549b1f5ba09fca15cda

$ git -C <sibling a2-react-aria checkout> rev-parse d1677b66:packages/core/src/components
1a455aab73a82ba039b3a549b1f5ba09fca15cda

$ git -C <sibling a2-react-aria checkout> rev-parse 27091f57^{tree}
fb6ce2026d98b6011ebf1650d1f3944c62b4d793

$ git -C <sibling a2-react-aria checkout> rev-parse d1677b66^{tree}
fb6ce2026d98b6011ebf1650d1f3944c62b4d793
```

The registry the CLI reads and the component sources it is generated from store the
identical tree object at `009d4471` and `d1677b66`, and the reviewed branch head and the
squash commit store the identical **whole-repository** tree. A squash of a branch whose
merge base is the whole of `main` reproduces that branch's tree exactly, which is why the
prediction this file made at the provisional pin could be made at all. The regenerated
`a2ra-manifest.json` bears it out independently: it reproduced byte-for-byte apart from its
two recorded pin lines, and all 74 upstream hashes are unchanged.

**Why move the pin at all, then.** The pin is what `check:a2ra-fidelity` measures against, so
it is also this repository's record of which upstream commit the vendored tree is aligned to.
Issue #151's fix is upstream, and leaving the pin at the commit before it would leave that
record naming a commit that does not carry the fix. A pin move that provably moves no byte is the
cheapest possible way to say "this tree is upstream's, at the commit that carries the fix",
and the gate keeps the claim honest: a manifest generated at another commit is a hard failure
rather than a silent pass, so the pin, the manifest and the tree cannot drift apart quietly.

**What the pin move does NOT deliver, stated plainly.** `a2ra.json` governs the vendored
component sources. It does not govern the npm dependency on `@a2ra/core`, which
`packages/ui/package.json` exact-pins at the published `1.0.0-preview.7`, and that published
package still declares `react-aria-components` as a hard dependency at `^1.18.0`. The peer
declaration reaches this repository only when upstream publishes the next preview. What
closes the duplicate here today is the lockfile, and the pull request body says so rather
than letting the pin move take credit for it.

## Which CLI, and why it is not `pnpm dlx`

Unchanged from the previous capture, and re-checked rather than carried over: the published
CLI at `1.0.0-preview.4` **reports this tree as drifted when it is not**. `diffLines` decided
whether anything moved by scanning its own rendered output for the substrings `"- "` and
`"+ "`; those mark a removed or an added line, and they also occur inside ordinary prose, so
a component whose source carries a spaced hyphen diffs as changed forever. The `Menu` prop
documentation added at the previous pin is the first registry source to contain one, and it
is still there.

The fix is on upstream `main` and therefore at this pin (`packages/cli/src/diff.ts`: the walk
records that it emitted a removal or an addition at the point it emits one). It is still not
published: the npm registry serves `@a2ra/cli` at `1.0.0-preview.4` as its newest version at
this capture. So the transcript below runs the CLI **built from the sibling a2-react-aria
checkout at this pin** (`pnpm --filter @a2ra/cli build`) rather than `pnpm dlx @a2ra/cli`,
written as `<cli>` in the console blocks. Both commands are otherwise the ones the guidelines
name. When a preview containing the fix is published, `pnpm dlx` goes back to being the
command.

`check:a2ra-fidelity` was never affected: it hashes bytes and never renders a diff.

## What moved, and the proof that nothing else did

A pin move re-vendors **every** component at once, so "only the intended fix changed" is a
claim about the whole tree rather than about the files that happen to be in the diff. At this
capture the claim is the strongest form of it: **nothing moved, in any component.**

The sweep below ran with the already-vendored bytes still in place, against the registry at
`d1677b66`, before any overwrite: seventeen components, seventeen clean.

```console
$ node <cli> --version
1.0.0-preview.4

$ for c in alert breadcrumb button card checkbox date-picker dialog form layout \
>          menu number-field radio select table text text-area text-field; do
>   printf "%-14s %s\n" "$c" "$(node <cli> diff "$c" | tr -d '\n')"; done

alert          ✓ All installed components are up to date.
breadcrumb     ✓ All installed components are up to date.
button         ✓ All installed components are up to date.
card           ✓ All installed components are up to date.
checkbox       ✓ All installed components are up to date.
date-picker    ✓ All installed components are up to date.
dialog         ✓ All installed components are up to date.
form           ✓ All installed components are up to date.
layout         ✓ All installed components are up to date.
menu           ✓ All installed components are up to date.
number-field   ✓ All installed components are up to date.
radio          ✓ All installed components are up to date.
select         ✓ All installed components are up to date.
table          ✓ All installed components are up to date.
text           ✓ All installed components are up to date.
text-area      ✓ All installed components are up to date.
text-field     ✓ All installed components are up to date.
```

Run `a2ra diff` with **one component named**, not bare: the bare form stops after the first
drifting file it finds, so it is a "something moved" signal rather than an enumeration. That
is why the sweep above is a loop. The `tr -d '\n'` is only so each verdict prints beside its
label: the CLI opens its report with a blank line, so without it the loop prints the label
and the verdict on two lines.

## The whole-tree overwrite

Every component was re-vendored from the registry at the new pin, not only the components
this change touches (there are none), so the tree is a copy of the pinned registry rather
than the previous tree left in place and trusted.

```console
$ node <cli> add alert breadcrumb button card checkbox date-picker dialog form layout \
>   menu number-field radio select table text text-area text-field --overwrite

✓ Added 75 file(s) for alert, breadcrumb, button, card, checkbox, date-picker, dialog,
  form, layout, menu, number-field, radio, select, table, text, text-area, text-field.

$ git status --porcelain packages/ui/src

```

Seventy-five files written, **none changed**, and an empty `git status` is exactly the
expected result of re-vendoring an identical tree from an identical registry. The count is
one above the tree's 74 files because `group-schema-fields.ts` is shipped by two items and
written twice; every file rewrote itself to the bytes it already had.

## The verdict

```console
$ node <cli> --version
1.0.0-preview.4

$ node <cli> diff

✓ All installed components are up to date.
exit=0

$ node scripts/check-a2ra-fidelity.mjs
check-a2ra-fidelity: OK - 74 vendored files byte-identical to roonga/a2-react-aria @ d1677b660784 (ADR-22).
exit=0
```

### And independently of the CLI, by git tree hash

The CLI compares text it fetched; a tree hash compares what git actually stored, on both
sides, with no fetch and no renderer in between. It is the check that would survive a second
CLI bug, so it is taken as well as the two above rather than instead of them: each vendored
component directory hashes to the identical tree object as upstream's own directory at the
pin.

```console
$ for c in alert breadcrumb button card checkbox date-picker dialog form layout menu \
>          number-field radio select table text text-area text-field; do
>   up=$(git -C <sibling a2-react-aria checkout> rev-parse d1677b66:packages/core/src/components/$c)
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
menu           identical e4853c2bd65a8dd55ca173e763c760d049e3e033
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

Every sha above is unchanged from the `009d4471` capture and from the `27091f57` one, which
is the per-directory form of the tree equalities at the top of this file: the same seventeen
trees, hashed against the squash commit this time instead of against the branch head.

A tree object hashes the names, modes and blob contents of everything under it, so an
identical tree sha means an identical set of files with identical bytes. Nothing about the comparison depends on the registry, the
network, or the CLI. The GitHub compare API is deliberately not used for this: it answers a
question about two commits, not about whether one directory in this repository equals one
directory in another.

## The negative control

A clean verdict from a gate that has never failed in front of you is a hypothesis, not a
control (055's retro lesson, applied here). One byte was appended to a vendored file, both
checks were re-run, and the file was restored - so the lines above are known to mean
"identical" rather than "not checked". It is taken again at this pin rather than carried over
from the previous capture or from the provisional one: a control proves the harness was
working at the moment the verdict above was taken, and copying one forward proves nothing
about this run.

The control is taken on `number-field/NumberField.tsx`. A pass that moves no source has no
"file this change touched" to control on, so the next best choice is the file the issue is
about: #151 is a hydration mismatch on the NumberField's `<input>`, and this is the component
that renders it.

Context lines are elided where marked; nothing else is edited.

```console
$ printf "\n" >> src/components/a2ui/number-field/NumberField.tsx   # deliberate one-byte drift

$ node <cli> diff number-field

── number-field/NumberField.tsx ──

[... unchanged context lines elided ...]

  			</Group>
  			{description && (
  				<Text slot="description" className={styles.description}>
  					{description}
  				</Text>
  			)}
  			<FieldError className={styles.errorMessage}>
  				{({ validationErrors }) => errorMessage ?? validationErrors.join(", ")}
  			</FieldError>
  		</RACNumberField>
  	)
  }

-

Run `a2ra add <name> --overwrite` to update.

$ node scripts/check-a2ra-fidelity.mjs
check-a2ra-fidelity: the vendored tree is not the pinned upstream tree (ADR-22):

  changed (content differs from upstream at the pin):
    number-field/NumberField.tsx  (upstream 92e81d628bf8, here 25691ac47ea9)
exit=1

$ node <cli> add number-field --overwrite   # restore from the registry

✓ Added 4 file(s) for number-field.

$ node <cli> diff

✓ All installed components are up to date.
exit=0

$ node scripts/check-a2ra-fidelity.mjs
check-a2ra-fidelity: OK - 74 vendored files byte-identical to roonga/a2-react-aria @ d1677b660784 (ADR-22).
exit=0
```

The trailing `-` line is the removed byte: the appended newline, reported as a line the
registry does not have. Both checks went red and then green on the same byte, which is what
makes them a pair rather than one gate and one echo of it. The hash pair in the failure,
`92e81d628bf8` upstream and `25691ac47ea9` with the byte appended, is the pair the
`27091f57` capture recorded, which is what an unchanged `NumberField.tsx` at an identical
tree has to produce; a different pair here would mean the re-pin had moved the file after
all.

Note the restore is `add --overwrite`, not `git checkout --`: it restores from the registry at
the current pin, so it cannot quietly put back a file from the old one.
