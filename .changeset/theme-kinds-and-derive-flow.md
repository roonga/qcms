---
"create-qcms-app": minor
---

The assistant's theme acts and the derive flow in the agent builder (task 117, G2, U5 and
G4b).

Two action kinds and one builder tool. `theme.derive` reads one website for a look: it
carries no `url` argument at all, so no proposal can name an address. Its card asks the
person to type one, echoes the whole address as wrapping text above Confirm so a long one
cannot hide its host, holds Confirm until it is an `https://` address, and hands that value
to the drawer's own control, which calls the API's SEC-18 route. A confirmed hand-off is
spent once: reopening the drawer reads nothing again. Nothing in the browser or the assistant
fetches anything, and the model never sees or chooses the address (SEC-18 W2). In the
drawer's own Get theme the typed address and the click is the confirm. `theme.save` keeps the
look the drawer is showing as a workspace theme and names the theme alone. `edit_appearance`
is a draft-scoped edit like the other four builder tools: it auto-applies with an Undo and
takes no card. One brand colour derives the colours for all four modes through the kernel,
which moves any pair too faint to read; the logo stays the person's own upload. The open
builder preview follows the draft a turn leaves, so an appearance edit and its Undo show
without a reload, except while the drawer is holding a look the draft has not got.

The drawer gains "From your website": an address, Get theme, and the look it answered as
value rows, with the line that nothing from the site is stored except those values and the
logo. Colours that were moved to stay readable are named one by one. Until the look is kept,
the Theme row reads "Not saved", and "Save as workspace theme" offers it to every form in the
workspace. Adjust keeps the look and closes the report; Cancel restores what was there. Every
control follows the locked-state pattern: a native element pointing at the one reason.

The builder screen's facts name the form's workspace, which no route parameter gives that
screen: without it neither theme act could be proposed there, since both name the workspace
the drawer acts in.

A derive answers the person's appearance panel, and the prompt says so: no part of the page
is sent to a model. What the browser holds for it is the `derived-theme` fact, which carries
hex colours, a registry face, whether a logo came with it, and which colours moved, and no
host, logo key or page text; no value that is not one of those shapes becomes a fact at all
(SEC-18 M1, M2, M3).

`SYSTEM_PROMPT_VERSION` is 38: a new system section for the three acts, the builder section
now names five edit tools, a derive no longer claims to report to the model, and the
appearance text says modes rather than palettes, as the glossary reserves palette for the
preview sets.
