# 066 - Environment-scoped secure links, the address prefix and the per-environment closed state

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api` (minting, redemption, the mount split, the closed-state check), `apps/portal` (the prefix and the non-prod host shape), `apps/admin` (the mint screen), `@roonga/qcms-db` (the link queries and the release state's closed value) · **Depends on:** 064 and 065; coordinates with 063
**References:** ADR-40 (the address rule and the release state) · ADR-39 (as amended: the closed state and the link target) · ADR-09 (the mount groups, whose Note this task amends) · ADR-24 (as amended: the per-environment configuration set) · SEC-14 (the network layer, and the recipe in `docs/deploy-ingress.md`) · SEC-2 · `plan/environments-and-workspaces.md` sections 3 and 5, and the 066 section of 8, and Q11, Q16, Q18, Q19, Q21, Q33, Q46 and finding 6 · issue #995 · issue #724

## Context

A secure link resolves to a form and, since ADR-39, to a target version. It has no environment. This task makes the environment part of minting and redemption, puts the environment's name in the path of every non-prod address, and turns the whole-form closed state into a per-(form, environment) state.

It is the task that reaches furthest into existing code, and it is where SEC-14's 404 claim stops being a description and becomes something built. Anonymous and secure-link entry are **one route** today (`POST /sessions` on the `public` group, discriminated by a body refine), so "no anonymous entry to test" cannot currently be a routing fact and would be a handler refusal instead. ADR-09's Note already carries a forward pointer saying this task owns the split and the amendment.

**Task 064 has already created the columns this task builds on**: `secure_links.environment` (`NOT NULL`) with the `(link_id, environment)` unique key, and `sessions.environment` (`NOT NULL`) with its composite foreign key and its `CHECK`. 064 also makes the **minimum** change to `insertSecureLink` and `createSession` so those inserts keep working under the new `NOT NULL` columns, writing the connection's own environment. **This task owns the behaviour on top**: choosing the environment at minting, requiring it on the API, refusing a caller that omits it, and refusing a token presented under the wrong prefix.

## The rulings that govern this task

Q11's challenge-provider half (the retention TTLs are 067's), Q16 (the environment is visible to a respondent in the path and nowhere else), Q18 (the closed state is per form **and** environment), Q19 (no default environment at minting: required on the API, taken from the Q6 switcher in the admin), Q21 (`/<env>/` on every non-prod address, `prod` unprefixed, and the environment never in the token), Q33 (who may close and reopen, which is task 067's authorisation half), Q46 (the thirteenth guard, whose API check this task keeps as defence in depth), and finding 6 (rate limits stay installation-wide). ADR-40 binds the address rule; ADR-39's Amendment binds the closed state; SEC-14 rests on the mount split.

## Deliverables

- **Minting and redemption using the environment on the `secure_links` row.** Minting a link for an environment is **required on the API** and a caller that omits it is refused (Q19); in the admin the mint screen takes it from the Q6 switcher, shows it in the banner and restates it in the confirmation. Redemption starts a session in that environment and writes the session's own `NOT NULL` `environment`, so the composite key and the `CHECK` both hold.
- **The `/<env>/` path prefix on every non-prod address, on the portal and the API alike, with `prod` unprefixed** (Q21), and the **refusal of a token presented under the wrong prefix**: refused, not redirected and not honoured. The environment stays out of the token: the path names it, the server-side row decides it.
- **The portal's non-prod host shape**, the second of SEC-14's two handles. The host is primary because a network-layer firewall and a DNS split can act on it without reading HTTP at all; the path is the handle an ingress or an L7 firewall acts on, and it is what makes a link legible to the person holding it. Both remain because they fail independently.
- **The SEC-14 operator recipe exercised**, so the "Restricting the test environment" section of `docs/deploy-ingress.md` describes something that has been run rather than something drafted.
- **The per-environment closed state** (Q18). The per-environment release state gains a closed value; `forms.status` and its `form_status` enum go away or become derived from those states; `POST /forms/{id}/close` and `/reopen` become per-environment operations; and the check in `apps/api/src/features/responses/start-session/handler.ts` that today reads `form.status` after the link's own state and before anything is spent reads the environment's state instead. Closing `prod` intake while a test run continues, and the reverse, are ordinary operations.
- **The mount work SEC-14 rests on**, which does not exist today and is three pieces: each environment's respondent surface as **its own mountable group** (Q2's recorded shape); **anonymous entry split from secure-link entry** so the two can ride different mount decisions; and the portal **not serving its `/f` segment on the test host**, which is portal routing and not an API mount.
- **The ADR amendments this task lands**: ADR-09's Note, because the split changes the count of groups riding the mount flags, and ADR-39's Amendment for the closed state if task 063 has not already landed it.
- **The challenge provider as a per-environment value** (Q11), read from the environment row rather than from the process environment. **The retention TTLs, Q11's other half, are task 067's**, with the retention sweep that reads them: one task owns each half so neither is built twice. Rate limits, the session TTL, anti-abuse thresholds and every other typed setting stay installation-wide (finding 6).

## Exit criteria

Exit criteria **1 to 8** of the 066 section of `plan/environments-and-workspaces.md` section 8. This task owns those and no others.

Criterion 3 is the one to read twice: there is no anonymous entry to a non-prod environment on any address, asserted as a **`404` and not a `403`** (ADR-09), and `/<env>/f/{slug}` does not exist. That requires the mount split above, so it is a criterion about **built behaviour** rather than about configuration, and an edge rule does not satisfy it.

## Files and areas

`apps/api/src/features/responses/start-session/handler.ts` (the closed-state check and the entry split), the `POST /sessions` route and the `public` mount group in `apps/api/src`, the secure-link mint and redeem routes and `packages/db/src/queries/secure-links.ts`, the release state's closed value in `packages/db/src/schema/` and `packages/db/src/queries/`, the `forms.status` column and the `form_status` enum, the portal's route tree and its host handling in `apps/portal/app/`, the admin's mint screen, `docs/adr/core.md` (ADR-09's Note and ADR-39's Amendment), `docs/deploy-ingress.md`, `docs/secure-links.md`, the portal and admin i18n catalogs, and a changeset.

## Gates

`pnpm verify`; `QCMS_PORT_SEAT=<0-9> pnpm verify:browser`, **once per environment** (Q9), run detached with `pnpm verify:browser:detached` and then `pnpm verify:browser:wait <dir>` in slices until it stops exiting 75, never in the foreground (issue #846); and `QCMS_PORT_SEAT=<0-9> pnpm up:e2e`, once per environment, because this task changes the boot environment and the mount set. Do not run `up:e2e` concurrently with `verify:browser` on the same seat.

## Out of scope (binding)

The schema layout, the roles, the baseline, the `secure_links` and `sessions` environment columns and the environment command (064): this task builds behaviour on them and adds none of them. Release records, promotion and the switcher (065). Per-environment delivery, retention, export, erasure and the restore drill (067), **the retention TTLs included**: Q11's other half is 067's and this task changes nothing about retention. **Who** may close, reopen, mint a `prod` link or set a `prod` endpoint (067 and 069): this task builds the operation and 067 carries Q33's and Q30's split. Workspaces and membership (068, 069). The two-person rule (070). Per-environment rate limits: finding 6 keeps them installation-wide. An environment visible in a token, as opposed to in a path.

## Coordination with task 063

**063 and this task change the same `secure_links` row and the same closed-state check.** Whichever lands second rebases onto the other rather than re-deciding either; ADR-39 carries a Note and an Amendment saying so. Concretely, 063 adds a target policy (Always latest, or one exact published version) to the link's server state and a pinned public route, while this task adds the environment to the same row's use and moves the closed check off `forms.status`. The link's target and its environment are independent fields and neither replaces the other.

## Notes for the executor

**The mount split is the deliverable most likely to be reported as done when it is not.** A handler that refuses anonymous entry on a non-prod environment returns a `403` and passes a casual read of the requirement. Criterion 3 asks for a `404`, which is only true when the route is not mounted, which is only possible once anonymous entry is its own route. Write the `404` assertion before the split.

**Task 064's database guard does not make the API check redundant.** The composite key and the `CHECK` make the invariant structural; the API check is what produces a legible refusal rather than a constraint violation. Keep both.

**A closed environment must refuse a secure link without consuming it.** Criterion 5's second half is the property issue #724 already bought for the whole-form state: a refused link is not spent and no challenge is charged. Carry that behaviour across to the per-environment state rather than rebuilding it.
