---
"@roonga/qcms-a2ui-compiler": patch
"@roonga/qcms-observability": patch
"create-qcms-app": patch
"@roonga/qcms-core": patch
"@roonga/qcms-csv": patch
"@roonga/qcms-db": patch
"@roonga/qcms-ui": patch
---

Declare what npm provenance needs, on every publishable package.

Each manifest gains `repository` (with the `type`, the `git+https` URL and its
`directory`), a `homepage`, a `bugs` URL, and `"provenance": true` beside the
existing `"access": "public"` in `publishConfig`.

**This is a prerequisite rather than a nicety.** npm documents a public
`repository` field that matches the publishing source, case-sensitively, as a
requirement for generating a provenance statement. None of the seven publishable
manifests carried one, so a publish with `--provenance` would have failed on a
release day, and SEC-11's promise of provenance attestations for every
`@roonga/qcms-*` package had no repository-side support at all. Task 040's
security review of 2026-10-23 found it.

`publishConfig.provenance` is a declaration and not an attempt: it takes effect
only on a publish from a supported CI provider with `id-token: write`, and npm
ignores it anywhere an OIDC token cannot be minted, so it cannot make a local
publish fail.

What this does **not** do is publish anything or verify a real attestation. The
registry side is still issue #360: nothing has ever been published, the
`@roonga` organisation does not exist, and the account's 2FA, the publish
identity and one disposable test publish are Code Owner acts.
`docs/security-review-2026-10-23.md` section 7 has the steps.

`scripts/check-publish-provenance.test.ts` derives the publishable set from git
rather than from a list, so the next publishable package added fails the gate
until it carries the same fields instead of silently shipping without
provenance.
