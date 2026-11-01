---
"qcms-admin": minor
---

An action card counts its waiting window from the moment it arrived (Code Owner,
2026-11-01).

- The card takes the window's length from the proposal (`expiresAt - proposedAt`) and
  counts it on a monotonic clock from arrival, so a browser whose own clock is out by more
  than the window no longer has every card arrive expired and unconfirmable.
- A waiting card now ticks itself into "Expired - ask again" with Confirm disabled when the
  window runs out. The timer is armed only while the card waits and is cleared when the
  card settles or goes.
- The API is unchanged and stays the authority: it checks the token against its own clock
  and refuses a stale one whatever the card shows.
