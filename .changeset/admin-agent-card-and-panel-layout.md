---
"create-qcms-app": patch
---

The assistant panel and its plan card lay out the way they read.

- A plan step's detail block sits in the step's text column at the step's width, instead of
  being auto-placed into the 20px marker track and wrapping word by word.
- A question definition reads as a two-column list: terms in a narrow column, values filling
  the rest.
- Step rows carry more vertical room, and a status chip centres its text.
- The panel takes its sticky and fixed geometry from the measured top bar height, so it
  starts under the bar and ends at the foot of the viewport.
- The conversation is the panel's only scroll container, the composer stays at its foot, and
  the page behind the expanded panel and the sheet does not scroll.
- The composer shows the app's focus ring.
- The expand toggle reads "Collapse the assistant" once the panel is expanded.
- A waiting plan step is marked with a dot rather than an outlined circle that read as a
  radio button.
