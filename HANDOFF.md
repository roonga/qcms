# HANDOFF: AWAITING-HUMAN Code Owner must rule on how an option id is minted for grid-created rows (see "The decision" below)

Task 057 (option grid). Parked before any implementation, deliberately: the card's ghost
add-row changes *when the author supplies a label*, and that silently changes *what option
ids get minted*. The consequence is permanent (R6) and it breaks the rule builder. This is
a product decision, not a lookup, so per the session protocol (§2, "blocked on a real
decision, stop and ask, never choose silently") it is surfaced rather than guessed.

**No code changes were made.** The branch is at `origin/main` (`e814d9a`) plus this file,
so the tree is clean and green and the next session starts from a known-good base.

## Prerequisites verified

- **Depends on 048:** ledger row 85 reads `done (PR #313; screenshot gate signed by the
  Code Owner 2026-08-06)`. Satisfied.
- **Card frozen:** `plan/admin-theme/ds-option-grid.html` has exactly one commit,
  `77c4e82` (2026-08-01, "FROZEN - Code Owner approved"), unchanged since. The
  design-churn rule from retro 032 is satisfied.

## The decision

### What the card requires

The card's ghost add-row is a **button**, not an input:

```html
<button type="button" class="opt-row--add">+ Add option</button>
```

and its behaviour note says: *"Enter on the ghost add-row appends a new option and focuses
its label."* The insert affordance is the same shape: *"clicking inserts an empty row there
and focuses its Label cell"* (task file, deliverable 3).

So under the card, **a row is created before the author has typed a label**.

### Why that changes ids

`addOption` mints the id from the label it is called with, via `mintOptionId`
(`apps/admin/lib/questions/definition.ts:78`), which falls back to `"option"` for empty
input:

```ts
const core = identifierCore(label);
const base = `opt_${core === "" ? "option" : core}`;
```

Minting at row-creation time therefore feeds it `""`, and every option authored through the
new grid becomes `opt_option`, `opt_option_2`, `opt_option_3`, ... instead of the
label-derived `opt_green` / `opt_yes_always` the shipped editor produces today.

### Why that is not survivable as-is

**The rule builder shows raw option ids as the picker labels, with no label lookup
anywhere.** `optionIdsOfVersion` drops labels entirely
(`apps/admin/lib/forms/condition.ts:152-158`), and the operand control renders the id as
the visible text:

```ts
// apps/admin/components/forms/operand-control.tsx:175
items={options.map((optionId) => ({ label: optionId, value: optionId }))}
```
(same at `operand-control.tsx:201` for the checkbox list and `condition-json-pane.tsx:334`.)

So an author writing "answer to Q equals ___" against a five-option question would choose
between five entries reading `opt_option`, `opt_option_2`, `opt_option_3`, `opt_option_4`,
`opt_option_5`, with no way to tell which is which. Rule authoring becomes guesswork, and
because ids are permanent (R6) the damage is not repairable after the fact.

### Why I may not just pick the other way either

Three binding constraints in the task file point *against* the card-literal reading:

- Out of scope (binding): *"Any change to option semantics, **ids**, or wire shapes."*
- Exit criterion 5: *"relabel/add/remove/reorder produce **identical wire payloads** to the
  pre-rebuild editor."*
- `definition.ts`'s own doc: minting is *"from the label it was added with, which is the
  whole point of minting once."*

But three point *toward* it:

- Task file deliverable 3: *"the id is minted at insert, never editable."*
- Shipped product copy, `questions.options.note`: *"An option ID is generated once, **when
  the option is added**, and never changes again."*
- The card's own mock ids are opaque (`opt_8f2ka91m`, `opt_3n7qz44p`), not label-derived,
  which suggests the designer did picture non-meaningful ids.

That is a genuine fork with binding text on both sides, which is why it is escalated.

### Options

1. **Card-literal: mint at row creation.** Simplest, matches the card's DOM exactly, no new
   state. Cost: opaque serial ids forever, and the rule-builder regression above. Would also
   need the existing e2e assertion `["opt_yes_always","opt_no_never","opt_green"]`
   (`questions-lifecycle.pw.ts:126`) rewritten to serials.
2. **Deferred minting (recommended).** The ghost row / insert creates a *pending* row in
   local component state with focus in its label cell, exactly as the card looks; the id is
   minted by `addOption` when the label is first committed, and is frozen and non-editable
   from that moment. Preserves label-derived ids, identical wire payloads, the existing e2e
   assertion, and the card's normative claims (layout, controls, keyboard rhythm, "minted
   once", "never editable"). Cost: a pending-row concept the card does not draw, and the ID
   cell needs a muted placeholder until the row is named.
3. **Ghost row as an inline input.** The ghost row is a textarea with a "+ Add option"
   placeholder; typing a label and pressing Enter appends with that label and returns focus
   to the ghost row for the next one. Keeps label-derived ids with no pending-row concept
   and no mutator changes, and is good for bulk entry. Cost: departs from the card's
   `<button>` ghost row and from its stated Enter rhythm.

**Recommendation: option 2.** It is the only one that satisfies every *binding* constraint
in the task file while keeping the card's visual and keyboard contract intact, and it is the
only one that does not damage rule authoring.

## Second item, resolved, no decision needed

Insert-at-index has no mutator in `definition.ts` (`addOption` only appends). It does **not**
need a new one: `addOption(options, label)` followed by repeated `moveOption(..., -1)` from
the tail to the target index produces exactly the inserted array using only the sanctioned
mutators, and each step is the shipped swap semantics. Flagging it only because the brief
asked to be told if a new mutator seemed necessary. It does not.

## Gate state at park time, and a trap worth writing down

`QCMS_PORT_SEAT=6 pnpm verify:browser` failed **twice** on the unmodified branch with a bare
`Error: Timed out waiting 180000ms from config.webServer`, which reads exactly like a slow
cold boot and is not. The real cause is in the wrapper's own capture file,
`apps/portal/.playwright/server-logs/portal.log`:

```
./apps/portal/lib/server/theme.ts:33:1
Module not found: Can't resolve '@qcms/ui/fonts'
 GET / 500 in 9ms
```

**`pnpm verify:browser` is bare `playwright test` (`package.json:15`). It does not build the
workspace packages.** A fresh worktree has `pnpm install`ed `node_modules` but no
`packages/*/dist`, so the portal dev server 500s on every request, Playwright's URL poll
never succeeds, and the run burns the full 180s and reports a timeout that names nothing.
The main checkout never shows this because its packages are already built.

**Fix, and the required first step for the next session in a fresh worktree:**

```sh
pnpm install
pnpm exec turbo run build      # restores packages/*/dist (was FULL TURBO, 84ms)
QCMS_PORT_SEAT=6 pnpm verify:browser
```

Seat-6 ports (17600/17610/17640/17630) were confirmed free. The `next dev --port 7040`
process on this box belongs to the **main checkout**, not this worktree, and does not
collide.

With the build step added, the baseline is **green: 179 passed in 9.9m, exit 0**. So the
suite is healthy and the branch starts from a known-good base; the two earlier timeouts were
entirely the missing build.

## Next step once the Code Owner rules

Build the presentation rebuild against the chosen minting rule. Everything else in the card
is unambiguous and ready to implement: grid markup and CSS, grip button with
`aria-haspopup="menu"`, the row menu (Insert above / Insert below / Remove option) with
row-naming accessible names, Arrow Up/Down reorder on the focused grip, hover **and**
focus-revealed insert points, drag with the `.opt-insert--drop` indicator, the
`.is-dragging` single-line clamp, the error treatment, the compact (ID-folded) layout keyed
off the editor's own width, and the ADR-27 catalog strings. Then the screenshot gate under
`docs/gates/057/` at 390 and 1280 in light/dark/HC.
