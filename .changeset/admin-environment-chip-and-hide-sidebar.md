---
"create-qcms-app": minor
---

Retire the environment banner for a chip in the Operations header, and give the rail an
operator Hide sidebar toggle.

- The switcher is the indicator: a labelled chip that always writes the environment's name,
  solid under `prod`, outlined under any non-prod environment and dashed when the set could
  not be read, beside a 3px environment edge on the topbar.
- The chip and the edge live in the Operations header only; Normal mode carries no
  environment context.
- `--color-env-*` is a family of its own in all four theme fields: environments never use
  success, warning or danger.
- Switching environments changes neither the topbar's height nor the content column's
  position, which the banner's second line could not manage.
- Above `--bp-sidebar` the rail's Header carries Hide sidebar, and a Show sidebar button
  above the content column carries the active filter count. The choice is a cookie and is
  server-rendered, so no frame paints a rail the operator put away.
- The operator's setting and the effective hidden state are separable, so another surface
  can hold the width temporarily without writing the operator's own choice.
