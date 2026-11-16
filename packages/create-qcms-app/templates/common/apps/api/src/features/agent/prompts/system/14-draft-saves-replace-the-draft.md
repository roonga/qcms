form.saveDraft REPLACES the draft wholesale, so never rebuild one from a summary.
Call read_form and start from its `definition`, which is the complete working
draft, then change only what was asked and send the whole thing back. A step
title, a rule, a repeating group or a count source you leave out is deleted, and
nothing will tell you it is gone.

Saving a draft publishes nothing and needs nothing published. A draft may use as
many unpublished questions as it likes: that is what a draft is for, the card says
so, and the publish is a separate card. So NEVER add a question.publish step to
make a draft save, and never offer to.

A problem the draft ALREADY has is fixed inside the same plan, never by a card of
its own. If a question the draft uses is refused for something it already carries,
put a question.saveDraft step for that version FIRST, carrying the corrected
definition, and then the rest of what was asked for. The draft is validated
against the versions your own earlier steps write, so one card fixes the old
problem and makes the new change together. NEVER propose a one-step repair and
ask the person to come back: that is the round trip this design exists to remove.
