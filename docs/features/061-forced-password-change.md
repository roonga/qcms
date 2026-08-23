# 061 - Force a password change on first sign-in after bootstrap

**Stage:** 8b · **Apps/packages:** `apps/api` (better-auth surface, schema), `packages/db` (migration), `apps/admin` (the forced-change screen and its gate) · **Depends on:** 031 (admin shell and 2FA), 056 (auth consolidated into the API, so the flag and the gate live on one side)
**References:** `docs/SECURITY_DESIGN.md` SEC-1 (password policy, `create-admin` as the only door to a first administrator) · ADR-35 as amended 2026-07-31 · issue #178 (the breach-corpus check, which the new password must also satisfy) · issue #319 (recovery codes; touches the same auth tables, so sequence the migrations)

## Context

`qcms:create-admin` sets the first administrator's password, and that password is typically **not chosen by the person who ends up using the account**. It comes from a shell command, a provisioning script, a CI variable, or an operator's terminal history - all places a standing credential should not live. Today it simply remains the account's password until somebody decides to change it, and nothing prompts them to.

Every comparable system closes this: a bootstrap credential is a _transfer mechanism_, not a permanent one. QCMS has no equivalent, and nothing in the product currently expresses "this credential is provisional".

This is a real gap rather than a nicety, but it is **not launch-gating** - it was raised on 2026-08-09 while adding developer tooling, and the Code Owner scheduled it to be slotted in rather than blocking 1.0.

## Deliverables

- **A durable "must change password" state** on the admin account, set by `create-admin` at bootstrap and cleared only by a successful password change. It must survive restarts and sessions: a flag held in a cookie or a session claim is not this. **Declare it through better-auth's documented `user.additionalFields`** rather than adding a column the library does not know about - see the executor notes.
- **A gate in the admin app** that redirects to the forced-change screen from anywhere else, for an authenticated principal whose flag is set. It must be a **server-side gate**, not a client redirect, and it must cover every admin route rather than being attached per page - the failure mode is one route added later that forgets it.
- **The forced-change screen**: current password, new password, confirmation, with the same validation the ordinary change-password path applies, including the breach-corpus check from #178 if that has landed. Chrome through the i18n catalog (ADR-27), keyboard operable, visible focus.
- **Interaction with 2FA enrolment decided and documented.** 031 forces TOTP enrolment on first sign-in. This task decides the order - almost certainly password change first, since the enrolment binds a factor to an account whose credential is still the provisional one - and records why.
- **`docs/SECURITY_DESIGN.md` SEC-1 updated** to state that the bootstrap credential is provisional and must be changed before the account is usable. The staleness rule applies: SEC-1 currently describes `create-admin` without saying the credential it sets is temporary.

## Exit criteria

1. A freshly bootstrapped admin signing in for the first time **cannot reach any admin route** until the password is changed. Asserted by driving a real sign-in and attempting a direct navigation to a deep route, not by unit-testing the gate function in isolation - the property is "no route is reachable", and only a route-level test can show that.
2. The flag is cleared by a successful change and **not** by anything else: not by a failed attempt, not by signing out and in again, not by a session refresh. Each of those asserted separately, because they fail separately.
3. The gate survives a **new route being added** - either by construction (a layout-level or middleware gate that a new page inherits) or by a test that fails when a route bypasses it. State which, and if it is the test, the test must be shown failing against a deliberately-added bypassing route.
4. An admin who has already changed their password is unaffected - no redirect, no prompt, no extra round trip on every request.
5. The order relative to 2FA enrolment is implemented, documented in `docs/a11y.md` or the admin README as appropriate, and asserted.
6. `pnpm verify` green with `turbo run test --force` at `0 cached`; `pnpm verify:browser` green, since this touches `apps/admin`.
7. `docs/SECURITY_DESIGN.md` updated in the same PR.

## Out of scope (binding)

Password expiry or rotation policies of any kind - NIST SP 800-63B Rev 4 explicitly advises against forced periodic rotation, and this task is about a **provisional bootstrap credential**, not a recurring policy. Self-service password reset (there is no email transport in the product). Any change to `create-admin`'s SEC-1 role as the only door to a first administrator. Multi-admin support.

## Notes for the executor

**The gate is the hard part, not the screen.** A forced-change screen is ordinary form work; a gate that cannot be bypassed by a route added six months from now is a design decision. Prefer a mechanism a new route inherits by default over one it must opt into, and say plainly which you chose.

**Sequence the migration against #319.** That issue changes how recovery codes are stored and touches the same auth tables. Two migrations landing in either order is fine; two migrations written without knowledge of each other is how a merge conflict becomes a data problem.

## What better-auth does and does not give you

Checked against the installed **better-auth 1.6.25** types and the vendor documentation on 2026-08-09, per the plan-against-official-docs rule. Both findings below change what you build, so read them before designing the schema.

**The flag has a documented home; use it.** better-auth exposes `user.additionalFields`, typed `Record<string, DBFieldAttribute>` in `@better-auth/core/dist/types/init-options.d.mts:133` ("Additional fields for the model"). The library applies declared defaults when it creates a user, and its own `customSyntheticUser` option is documented in terms of "processed additional fields from `options.user.additionalFields` (with defaults applied)" - so a field declared this way is one better-auth knows about, populates and returns on the session user. A column added to the table behind the library's back is not, and the difference shows up as a flag that is absent from the session object exactly when the gate needs to read it. **Declare the field; do not bolt on a column.**

**There is no library support for the enforcement, and you should not go looking for one.** 1.6.25 ships no "force password change", "must change password" or equivalent hook: nothing in the core options, no first-party plugin, and nothing in the documented `databaseHooks` that can refuse an authenticated request on a user-field predicate. `changePassword` exists and is what the screen calls, but nothing consumes a flag to require it.

That is the finding, not a gap to work around: **the gate is entirely ours**, and exit criterion 3 is therefore the whole risk of this task rather than an afterthought. Do not spend a cycle searching for a plugin that would make it disappear, and do not adopt a half-fitting one (the admin plugin's `banned` field is the nearest shape and it is the wrong semantics - a banned account is refused, not redirected to a remedy). Build the gate at the framework layer, where a new route inherits it, and say plainly in the PR which mechanism you chose and what would defeat it.
