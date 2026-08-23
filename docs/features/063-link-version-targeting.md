# 063 - Public and secure link version targeting

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `apps/admin`, `apps/portal`, `@qcms/db` · **Depends on:** 038 (launch validation), 024 (secure links), 029 (portal), 034 (publish and version history)
**References:** ADR-39 · ADR-07 · ADR-16 · SEC-2 · R1

## Context

Launch links always resolve the newest published form version. ADR-39 adds an explicit administrator choice between **Always latest** and **Pin to version** for both public and secure distribution. Session pinning remains unchanged after start.

## Deliverables

- Add the pinned public route `/f/{slug}/v{version}`. It starts only the named published version and uses the same form-open, challenge, abuse, session, and expiry checks as `/f/{slug}`.
- Store a pinned public version's distribution state outside the immutable snapshot as `open`, `redirect`, or `closed`. Redirect sends the respondent to `/f/{slug}`. Closed renders a localized explanation. Closing the form overrides every version state.
- Extend secure-link server state with a target policy: Always latest or one exact published version. Keep the signed token format unchanged and default existing rows to Always latest. Public version-address state does not affect secure invitations, which retain their own revocation lifecycle.
- Add the target choice to secure-link minting. Pin-to-version requires an existing published version and remains fixed for the link's lifetime.
- Show both public choices after publish and in version history: copy Always latest or copy the selected version's stable URL. Put version-state controls beside the version they govern.
- Require a confirmation before redirecting or closing a pinned public address, stating what existing recipients will experience.
- Update generated OpenAPI documents, operator documentation, exports, and localized admin and portal messages.

## Exit criteria

1. Public Always latest resolves the newest published version; a pinned public URL resolves its selected version before and after a later publish.
2. Secure links support both policies; existing and migrated links still resolve Always latest.
3. Open, redirect, closed, whole-form closed, revoked, expired, and consumed states compose without bypassing challenge or abuse controls.
4. Sessions never change version after creation, including when their source link later changes state.
5. Admin publish, version-history, and secure-link flows expose the targeting choice accessibly and pass their browser tests.
6. `pnpm verify` and the applicable browser and cross-service suites pass.

## Out of scope

Changing a published snapshot, migrating an existing session, link analytics, custom public-link slugs, non-expiring secure links, or automatically changing a pinned link when a newer version publishes.
