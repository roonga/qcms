---
"qcms-admin": minor
---

The step screen confirms its autosaves (Code Owner, 2026-08-26).

The ambient save strip is the FORM's and moved to the form's own screen when the builder
became two screens, which left the screen where most editing happens with no sign that
anything was being stored. A brief "Saved" now appears beside the step's heading when a
save lands, and goes after 1.8 seconds.

`plan/admin-design-contracts.md` §6's "exactly one save statement per screen" is kept
rather than bent: the form screen has the strip and not this, the step screen has this and
not the strip, and neither shows two. The division is deliberate as well as convenient -
the strip states the save MODEL persistently, which is what design-language element 7 is
about, while this states one save and gets out of the way.

**It takes no space when it is gone.** It sits in the step heading's own row, whose height
the heading sets; a transient element in the column's flow would push the screen down as it
arrived and pull it back as it left, a layout shift twice per save. Measured across a real
edit: the heading stayed at y=142 before, during and after.

**It fires on a change, not on a mount.** Seeded with whatever instant was true when it
mounted, because arriving on a step after any earlier save this visit otherwise flashed
"Saved" for a save that had happened minutes ago on another screen.

**It does not announce, and that is a judgement rather than an oversight.** It fires on
every debounced autosave - every few keystrokes - and a live region saying "Saved" that
often is hostile to anyone listening. The announced statement is the strip's own live
region on the form screen, which changes at most once a minute. What a screen reader still
gets on the step screen is every save that goes WRONG: autosave-paused and save-failed are
alerts and they stay on both screens.
