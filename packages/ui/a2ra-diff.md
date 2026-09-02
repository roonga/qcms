# Vendoring fidelity transcript (`a2ra diff`)

`docs/COMPONENT_GUIDELINES.md` step 1: vendored sources under `src/components/a2ui/**`
stay byte-identical to the pinned registry, and **fidelity is provable only by
`a2ra diff`** - so its transcript is committed with the change rather than asserted in a
PR body. Task 028's retro (`docs/RETRO.md`) recorded the absence of this file as a
reviewer friction; task 032 is where it starts existing.

Refresh this file whenever `a2ra.json`'s pin moves or a component is added, overwritten
or upgraded. It is evidence, not configuration: nothing reads it.

- **Registry pin** (`a2ra.json`): `roonga/a2-react-aria` @
  `e4f8b3642c3ce3aa7ac75396c214fdaa98701af1`
- **Previous pin**: `924eac1a04c86fcf0945859ade3de14af3ba7ce7`
- **Captured**: 2026-09-02, the upstream pass carrying issues #99, #148, #549 and #151
- **Components installed**: alert, breadcrumb, button, card, checkbox, date-picker,
  dialog, form, layout, menu, number-field, radio, select, table, text, text-area,
  text-field

## What moved, and the proof that nothing else did

A pin move re-vendors **every** component at once, so "only the intended fix changed" is
a claim about the whole tree rather than about the files that happen to be in the diff.
The new pin is a single commit on top of the previous one, and it was diffed component
by component before the overwrite: `date-picker`, `radio` and `select` drifted, and the
other fourteen reported clean.

```console
$ pnpm dlx @a2ra/cli --version
1.0.0-preview.4

$ for c in alert breadcrumb button card checkbox dialog form layout menu \
>          number-field table text text-area text-field; do
>   printf "%-14s " "$c"; pnpm dlx @a2ra/cli diff $c; done

alert          ✓ All installed components are up to date.
breadcrumb     ✓ All installed components are up to date.
button         ✓ All installed components are up to date.
card           ✓ All installed components are up to date.
checkbox       ✓ All installed components are up to date.
dialog         ✓ All installed components are up to date.
form           ✓ All installed components are up to date.
layout         ✓ All installed components are up to date.
menu           ✓ All installed components are up to date.
number-field   ✓ All installed components are up to date.
table          ✓ All installed components are up to date.
text           ✓ All installed components are up to date.
text-area      ✓ All installed components are up to date.
text-field     ✓ All installed components are up to date.
```

Run `a2ra diff` with **one component named**, not bare: the bare form stops after the
first drifting file it finds, so it is a "something moved" signal rather than an
enumeration. That is why the sweep above is a loop.

The three that drifted match the four upstream fixes exactly, and nothing else:

| Component     | File                     | Change                                                       | Issue      |
| ------------- | ------------------------ | ------------------------------------------------------------ | ---------- |
| `date-picker` | `date-picker.styles.ts`  | `requiredIndicator` token added                              | #99        |
| `date-picker` | `DatePicker.tsx`         | required marker in the `<Label>`; guarded parse; `string \| null` | #99, #549, #148 |
| `date-picker` | `DateRangePicker.tsx`    | required marker in the `<Label>`; guarded parse               | #99, #549  |
| `date-picker` | `date-picker.shared.tsx` | `parseDateOrNull` / `parseDateRangeOrNull` helpers added      | #549       |
| `radio`       | `RadioGroup.tsx`         | `value?: string \| null`                                      | #148       |
| `select`      | `Select.tsx`             | `value?: string \| null`                                      | #148       |

The fourth upstream change (#151) is a dependency range on `@a2ra/core`, not a component,
so it does not appear in this transcript at all. See the PR body for how it was verified.

## The verdict

```console
$ pnpm dlx @a2ra/cli diff

✓ All installed components are up to date.
```

## The negative control

A clean verdict from a gate that has never failed in front of you is a hypothesis, not a
control (055's retro lesson, applied here). One byte was appended to a vendored file, the
diff was re-run, and the file was restored - so the line above is known to mean
"identical" rather than "not checked".

The control is taken on `date-picker.styles.ts` this time, one of the files the pin move
actually changed: a control on an untouched file would prove the harness works without
proving it works on the bytes under review.

Context lines are elided where marked; nothing else is edited.

```console
$ printf "\n" >> src/components/a2ui/date-picker/date-picker.styles.ts   # deliberate one-byte drift

$ pnpm dlx @a2ra/cli diff date-picker

── date-picker/date-picker.styles.ts ──
  export const getDatePickerStyles = () => ({
  	root: "flex flex-col gap-1",
  	label: "text-sm font-medium text-(--color-text)",
  	requiredIndicator: "text-(--color-danger)",

[... 43 unchanged context lines elided ...]

  	rangeSeparator: "text-(--color-text-muted) px-1 text-sm",
  })

-

Run `a2ra add <name> --overwrite` to update.

$ pnpm dlx @a2ra/cli add date-picker --overwrite   # restore from the registry

✓ Added 6 file(s) for date-picker.

$ pnpm dlx @a2ra/cli diff

✓ All installed components are up to date.
```

The trailing `-` line is the removed byte: the appended newline, reported as a line the
registry does not have. Note the restore is `add --overwrite`, not `git checkout --`: at
the moment the control was taken the re-vendored files were uncommitted, so a checkout
would have restored the files from the OLD pin and left the tree quietly stale.
