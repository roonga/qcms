# Gate: the forms list creates on its own route (issue 685)

Approve that `/forms` reads as a list now that its inline create card is gone, and that
`/forms/new` is the screen that card became.

| Frame | What to look at |
| --- | --- |
| `forms-list-390.png` | The list at 390. Nothing above the table but the heading and the `New form` link. |
| `forms-list-1280.png` | The same at 1280. This is the change: the table is the first thing on the screen. |
| `new-form-390.png` | The creating route at 390, before a slug is typed. |
| `new-form-1280.png` | The creating route at 1280, on the 40rem measure `/questions/new` takes. |
| `new-form-1280-typed.png` | The one-way door open: the callout shows the `frm_` id the slug will mint, and says it is permanent (R6). |

Shot by `apps/admin/e2e/gate-685.pw.ts`, one frame per `test()`, each asserted before the
shutter (the list frames assert that no `Slug` textbox exists on `/forms`).

**The state these frames cannot show** is the empty library, which is where the panel's new
primary CTA renders. The seeded fixture always has forms in it and nothing a browser can do
removes one (no delete exists anywhere, R6), so that state is evidenced at the layer that
can reach it: `apps/admin/app/(shell)/forms-create-route.test.tsx`.
