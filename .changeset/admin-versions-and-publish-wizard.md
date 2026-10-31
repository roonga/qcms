---
"create-qcms-app": minor
---

Merge the version and release screens into one Versions view, and add the publish wizard
that drives the release-review, release-batch and publish-batch routes.

- Versions carries what each environment is serving and whether its intake is open, the
  immutable versions with their publisher and **Available in**, a stable Review action on
  every row, and the append-only release history with its rollback marking.
- Available in names the environments a version is releasing now, not every environment it
  ever reached; the list filter still reads "has reached".
- `/forms/{id}/publish` is the one entry that creates a version or releases one: a source
  (the shared draft or an exact version), the destinations the caller may release into, a
  per-destination review, then one confirmation.
- One confirmation is one call and one transaction, never a loop over single-target
  releases. A draft freezes one snapshot that every destination shares.
- Destinations outside the caller's access are omitted; accessible but blocked ones are
  disabled with the reason the review gave. Back and cancel write nothing.
- A stale review is refused with nothing written and read again before a second
  confirmation. An uncertain answer offers the recorded result by its idempotency key, or a
  replay of the same key, so a lost answer cannot mint a second version.
- "Create version without releasing" is the draft's exclusive choice, and the route a
  production-only deployment with the second-approver rule takes to its first release.
- The review now reports `APPROVER_IS_AUTHOR` for a draft into a protected destination,
  where the publisher is the confirming account.
- The builder's own Publish and "Publish to {env}" dialogs are retired (Code Owner,
  2026-10-31): the builder links into the wizard under the same capability gate, and
  `publishFormAction` and `publishAndReleaseAction` are gone. The freeze summary and the
  agent-provenance marker are the wizard's review step; a refused draft publish names how
  many issues blocked it and sends the author to the builder, whose validation panel holds
  the anchored work list.
- `/forms/{id}/releases` redirects to the Versions view, and the agent screen table names
  `/forms/[formId]/publish` in its place.
- The admin's `publishForm` and `publishAndRelease` clients are gone with the dialogs that
  called them. The API endpoints behind them are unchanged.
