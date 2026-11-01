---
"create-qcms-app": minor
---

Mirror the proposal marker, the hand-off seam and the response export into the scaffolding
templates.

A card waiting on a screen reaches that screen's heading row through one context above both
the panel and the page, so the control the card's first not-yet-run step mirrors carries an
"Assistant proposed · Review" marker: words, an icon and a dashed outline, a link to the
card and never a second Confirm. The control itself behaves exactly as it does with no card
anywhere, and the marker clears the moment the card is confirmed, cancelled or expired.

The same context carries a hand-off. A hand-off step carries no token and sends nothing:
Confirm opens the screen's own control with the step's non-secret arguments filled, and the
user finishes it there. The response export is the first of them, so the file is built by
the screen's own download and no byte of it reaches the assistant or the provider.
