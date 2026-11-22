---
"create-qcms-app": minor
---

The assistant's theme acts and the derive flow in the agent builder (task 117, G2, U5 and
G4b).

Two action kinds and one builder tool. `theme.derive` reads one website for a look: it
carries no `url` argument at all, so no proposal can name an address. Its card asks the
person to type one, shows it in full, holds Confirm until it is an `https://` address, and
hands that value to the drawer's own control, which calls the API's SEC-18 route. Nothing in
the browser or the assistant fetches anything, and the model never sees or chooses the
address (SEC-18 W2). `theme.save` keeps the look the drawer is showing as a workspace theme
and names the theme alone. `edit_appearance` is a draft-scoped edit like the other four
builder tools: it auto-applies with an Undo and takes no card. One brand colour derives all
four palettes through the kernel, which moves any pair too faint to read; the logo stays the
person's own upload.

The drawer gains "From your website": an address, Get theme, and the look it answered as
value rows, with the line that nothing from the site is stored except those values and the
logo. Colours that were moved to stay readable are named one by one. Until the look is kept,
the Theme row reads "Not saved", and "Save as workspace theme" offers it to every form in the
workspace. Adjust keeps the look and closes the report; Cancel restores what was there. Every
control follows the locked-state pattern: a native element pointing at the one reason.

What a derive lets the next turn see is the browser's own `derived-theme` fact: hex colours, a
registry face, whether a logo came with it, and which colours moved. No host, no logo key and
no page text, and no value that is not one of those shapes becomes a fact at all (SEC-18 M1,
M2, M3).

`SYSTEM_PROMPT_VERSION` is 34: a new system section for the three acts, and the builder
section now names five edit tools.
