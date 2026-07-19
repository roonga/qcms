# 026 — Abuse controls

**Stage:** 6 · **App:** `apps/api` · **Depends on:** 018, 019, 020
**References:** `ARCHITECTURE.md` §8 · ADR-12

## Context

Protections that guard the data model live in the API; vendor-shaped challenges live in the shell as an adapter (the Turnstile slot lands with the portal, 029). This task tunes and completes what 018/020 stubbed.

## Deliverables

- **Rate limiting** (017's pluggable store), configured per endpoint class with documented defaults: session creation per-IP (e.g. 20/hour), answers per-session (e.g. 2/sec sustained, burst 10) and per-IP, submit per-session (e.g. 5/min). 429 with `Retry-After`. Limits configurable via 017's config schema.
- **Session-token binding hardening:** token bound to sessionId with purpose claim (018); optionally bind a client fingerprint hash (soft signal, logged not enforced — document why: proxies/NAT make hard enforcement hostile to legitimate users).
- **Honeypot:** compiler (011) emits a visually-hidden decoy field in each step document (aria-hidden, off-screen, `autocomplete="off"` — must be invisible to screen readers, verify with 030); 020 flags sessions that filled it. Coordinate the field contract between compiler and API here.
- **Min-time-to-complete:** per-form configurable floor (default from config); 020 flags below-floor submissions. Also a per-step floor signal (answer arriving < N ms after step fetch) logged as a soft signal.
- **Challenge adapter seam:** `ChallengeVerifier` interface in the API (`verify(token, ip): Promise<ok|fail>`); the implementation is selected by the `QCMS_FLAG_CHALLENGE_PROVIDER` deployment flag (ADR-24) — null verifier for `none` (the default). Per-form `challengeRequired` setting (domain config, not a flag — ADR-24) checked at start-session; with provider `none` it no-ops. The Turnstile implementation itself is shell code (029). Here: the seam, the per-form setting, and the null implementation.
- Flag review data model finalized (with 020/023): flag reasons enumerated (`HONEYPOT`, `MIN_TIME`, `RATE_ANOMALY`), queryable in 023's listing.

## Exit criteria

1. Rate-limit tests per class: under limit passes, over limit 429s, window resets; limits configurable.
2. Honeypot round-trip: compiled fixture contains the decoy; filled decoy → flagged, success-shaped response; empty decoy → clean.
3. Min-time: sub-floor submit flagged; configurable per form.
4. Challenge seam: with a test verifier wired, start-session without token rejected for a `challengeRequired` form; null verifier = no-op.
5. axe check on a rendered honeypot (coordinate with 028 if renderer exists, else DOM-level assertion): invisible to assistive tech.

## Out of scope

Turnstile implementation (029 shell), IP reputation/geo blocking (adopter ingress concern — document), CAPTCHA UI.
