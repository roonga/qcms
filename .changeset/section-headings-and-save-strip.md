---
"qcms-admin": minor
---

Form screens stop repeating what the breadcrumb already says, and the save strip stops
moving (Code Owner, 2026-08-26).

**The section heading is the section's name.** It read "Links: kitchen-sink" directly
beneath a breadcrumb reading "Forms / kitchen-sink / Links" - a mashup of two crumbs one
line below them - and the form's identity is now on screen three times over: that
breadcrumb, the rail beside it, and the form id line under the heading.

Issue 679's fix is kept rather than reverted, because its defect was a different one: all
five section screens used to render the SAME heading, the form's slug, so the one landmark
heading a screen reader navigates by answered "which form" instead of "which page" on every
one of them. Five distinct headings is what that was for, and "Preview", "Version history",
"Links", "Responses" and "Webhooks" are five distinct headings. The test that asserts they
differ is untouched; `forms.section.heading` is now unused.

This does deviate from the drawings - `preview-versions-poc.html` and `responses-poc.html`
compose both parts - and they were drawn before this rail carried the form's name on every
one of these screens. Ruled on rather than transcribed, the same way 679 itself was.

**The save strip shows the state alone,** `Last saved <date time>`, with "This draft saves
automatically as you edit" one press away behind a "?" beside it. §6 is amended in
`plan/admin-design-contracts.md` rather than quietly bent: "persistent chrome" was the
letter, and the reason - an author must not be able to assume the wrong save model -
survives, because the sentence is on the screen it describes, next to the state it explains,
and is not a `title` attribute or a link to documentation.

It also stops moving. The strip was the model sentence, the state, and a third span that
appeared while a save was in flight, so it changed width three times per save. One slot
now, anchored to the end of its row: measured, the "?" held x=1236 before and after a save
where the text went from "Not saved yet" to "Last saved Aug 28, 2026, 10:27 PM UTC".

The "?" itself does not move when pressed. The sentence it reveals is a sibling of the
state row rather than another item inside it: the row is anchored to its end, so anything
added after the button pushed the button left - out from under the pointer that had just
pressed it. Measured across opening, closing and a save landing while open: x=1236, y=132
every time.
