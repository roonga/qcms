# Vendoring fidelity transcript (`a2ra diff`)

`docs/COMPONENT_GUIDELINES.md` step 1: vendored sources under `src/components/a2ui/**`
stay byte-identical to the pinned registry, and **fidelity is provable only by
`a2ra diff`** - so its transcript is committed with the change rather than asserted in a
PR body. Task 028's retro (`docs/RETRO.md`) recorded the absence of this file as a
reviewer friction; task 032 is where it starts existing.

Refresh this file whenever `a2ra.json`'s pin moves or a component is added, overwritten
or upgraded. It is evidence, not configuration: nothing reads it.

- **Registry pin** (`a2ra.json`): `roonga/a2-react-aria` @
  `924eac1a04c86fcf0945859ade3de14af3ba7ce7`
- **Captured**: 2026-08-01, task 032 (vendoring the `menu` component)
- **Components installed**: alert, breadcrumb, button, card, checkbox, date-picker,
  dialog, form, layout, menu, number-field, radio, select, table, text, text-area,
  text-field

## The verdict

```console
$ pnpm dlx @a2ra/cli --version
1.0.0-preview.4

$ pnpm dlx @a2ra/cli diff

✓ All installed components are up to date.
(exit 0)
```

## The negative control

A clean verdict from a gate that has never failed in front of you is a hypothesis, not a
control (055's retro lesson, applied here). One byte was appended to a vendored file, the
diff was re-run, and the file was restored - so the line above is known to mean
"identical" rather than "not checked".

Context lines are elided where marked; nothing else is edited.

```console
$ printf "\n" >> src/components/a2ui/menu/Menu.tsx   # deliberate one-byte drift

$ pnpm dlx @a2ra/cli diff menu

── menu/Menu.tsx ──
  import { Button, MenuItem, MenuTrigger, Popover, Menu as RACMenu } from "react-aria-components"
  import type { MenuItemEntry } from "./menu.schema"
  import { getMenuStyles } from "./menu.styles"

[... 62 unchanged context lines elided ...]

  			</Popover>
  		</MenuTrigger>
  	)
  }

-

Run `a2ra add <name> --overwrite` to update.

$ git checkout -- src/components/a2ui/menu/Menu.tsx   # restore

$ pnpm dlx @a2ra/cli diff menu

✓ All installed components are up to date.
```

The trailing `-` line is the removed byte: the appended newline, reported as a line the
registry does not have.
