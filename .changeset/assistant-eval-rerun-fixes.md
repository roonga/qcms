---
"create-qcms-app": patch
---

Carry the assistant's eval re-run fixes into the scaffolded app.

- The assistant's prompt gains the dates rule, the one-look-up-clause rule, the banned
  card-reason endings, the no-unasked-for-card rule and the prod-only-site case, and its
  avoid-words list gains `release`, `releases`, `mint` and `mints`.
- A turn carries `viewerToday`, the day on the viewer's own clock, so the assistant writes
  the date their screen shows.
- `propose_plan` takes an optional `title`, the plan's outcome in the person's words, shown
  as the heading of a card with more than one step.
- The card names the subject an earlier step makes rather than the id it reported, marks a
  quoted reason it had to clip, shows that reason above the steps, and keeps the sentence
  about real respondents for the steps that publish a form to prod.
