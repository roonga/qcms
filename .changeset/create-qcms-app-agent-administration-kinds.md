---
"create-qcms-app": minor
---

Mirror the publish kind's batch route and the workspace administration kinds into the
scaffolding templates.

The publish kind runs the Publish wizard's own `publish-batch` route and freezes the draft
into one destination, so it keeps that route's stale-review and workflow-revision checks: a
draft saved between the proposal and Confirm is refused and nothing is written. A route
whose policy row takes its environment from the body's `targets` is accepted by the
provenance check only when the batch names exactly one destination and it equals the step's
own environment; none and two are both refused.

The six administration kinds (create and remove an access group, grant and revoke it, set a
member's role, save the workspace settings) each run the workspace screen's own server
action, so ADR-41's self-grant refusal and the last-owner refusal stay the route's and the
card reports whichever of them the screen would report.
