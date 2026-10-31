---
"create-qcms-app": minor
---

Mirror the first screen groups' agent action kinds into the scaffolding templates: the
form's settings and intake, the release, the erasure and unflag, and the webhook endpoint
and dead-letter acts.

Each kind is proposed, never run: the user confirms it on a card that shows every argument
in full, and Confirm calls the screen's own server action with one trailing proposal
reference it forwards as the two provenance headers. The card asks for the typed
confirmation an irreversible act's own dialog asks for, matched exactly as that dialog
matches it, and carries one card-level band for it. A created or rotated endpoint secret is
revealed on the card once and is on no result allowlist, so no later turn can learn it.

Where one route and method serve several acts, each kind declares the exact body member set
its request carries, and a body matching none of them resolves to no kind and is refused.
