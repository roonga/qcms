---
"create-qcms-app": minor
---

The Appearance drawer in the agent builder, and workspace themes and the appearance lock on
workspace Settings (task 116, U4 and U6).

The drawer opens from the builder's preview toolbar and sits beside the live preview: theme,
page tint, face, text size, density, corners and progress mode. Every change renders in the
preview at once, and Done saves it through the one draft PUT, so an appearance change takes
one revision like any other edit. The theme list offers the four shipped looks, whose
palettes are derived on the server from each theme's accent by the shared appearance module,
and every theme the workspace has saved. The deployment's look is what a form with no
appearance shows, and it is what the drawer's Reset goes back to.

`apps/admin/lib/forms/text-size.ts` is the text-size rule: presets at 16, 18 and 20 px,
bounds of 16 to 24, one step at a time stopping at each bound, and Custom as a state the
value puts the control in rather than a value of its own. It also carries the 32 px cap on
the product of the admin's base and the respondent's scale, and names the scale at which a
base first reaches it.

While the workspace's appearance lock is set, every control in the drawer is disabled and
points at one reason naming who can clear it, and Done attempts no save, so the UI offers no
act the draft PUT would refuse. A refusal on contrast is worded pair by pair from the
correction report the API returns.

Workspace Settings gains the workspace's themes, with rename, delete and a raster logo
upload for an Edit forms holder, and the appearance lock switch for a Workspace
administrator or a Site administrator. Each half names the role it needs rather than hiding
its controls. A theme is created from the builder's drawer, not here.

`GET /admin/workspaces/{id}/settings` now carries `appearanceLocked`, so the Settings screen
shows the lock without a read of its own.
