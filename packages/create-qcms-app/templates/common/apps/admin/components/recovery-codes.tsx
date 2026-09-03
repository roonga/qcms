"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { copyRecoveryCodes } from "@/lib/recovery-copy";

/**
 * The ten codes and the control that copies them (issue 683).
 *
 * ## Why this exists at all, given the screen shipped without it
 *
 * Both POCs draw a "Copy codes" button with a status line beside it
 * (`plan/admin-shell-poc/auth-poc.html`, `plan/admin-shell-poc/settings-newquestion-poc.html`),
 * and they draw it identically: the same markup, the same placement between the list and the
 * confirm form, and the same two sentences. Each carried a comment saying the shipped screen
 * deliberately had none, because "a clipboard write needs client JavaScript and a status
 * region the admin has no other use for yet". `docs/admin-constraints.md` now says plainly
 * that JavaScript is available in the admin and a design may depend on it, so the ground for
 * declining it is gone, and under POC-wins a drawing is the approved design rather than a
 * proposal.
 *
 * The one JavaScript constraint that does bind these screens is untouched by this:
 * `docs/admin-constraints.md` keeps the auth **flow** on named route handlers so the endpoint
 * set is not republished (ADR-35 / SEC-1). The confirm below is still a plain `method="post"`
 * form to `two-factor/recovery-codes/confirm`, rendered by the server component that mounts
 * this one. Nothing about the flow moved into the client; a copy button did.
 *
 * ## Why the list is in here rather than left on the page
 *
 * The codes have to reach the client for a clipboard write to be possible at all, so the only
 * question is whether the client also renders them. It does, deliberately: one component owns
 * both the text on screen and the text that is copied, which makes "what you copied is
 * exactly what you can see" a property of the code rather than of two places agreeing. The
 * alternative - scraping the rendered `<li>` elements, which is what the POC's own script does
 * because a static HTML file has nothing else to read - would make a styling change able to
 * alter a credential.
 *
 * ## Why the status line is local and polite
 *
 * Local, because the app's shared live region (`lib/announce.ts`) is mounted in the `(shell)`
 * layout and these screens are outside it: there is nothing to speak into here. Polite, and
 * for the same reason `secure-links.tsx` argues for polite rather than the assertive treatment
 * #307 gave the webhook secret: what this announces is an **outcome and never the codes**. The
 * codes stay on screen either way, so a missed announcement costs a moment, while assertive
 * would interrupt whatever the screen reader was saying about the screen the operator just
 * landed on.
 *
 * The region is rendered empty from the first paint rather than mounted on the first press. A
 * live region only announces a change to a region the screen reader was already watching, so
 * one that arrives with its text already in it is the shape #307 had to remove.
 *
 * The codes themselves are never announced, never logged and never sent anywhere: SEC-13's
 * allowlist is written for this class of value, and a code read aloud is a code that cannot be
 * copied anyway.
 */
export function RecoveryCodes({ codes }: { readonly codes: readonly string[] }) {
  const [note, setNote] = useState("");

  const copy = useCallback(() => {
    // The DOM lib types `navigator.clipboard` as non-nullable, which it is not: an insecure
    // context or an older engine simply has no such property. The annotation widens it so the
    // absent case can be tested for, rather than compared against a type that says it cannot
    // happen (the same trap `document.body === null` sets, which `sonarjs` flags for the
    // identical reason).
    const clipboard: Clipboard | undefined = navigator.clipboard;
    // No `.catch`: `copyRecoveryCodes` resolves on every path by construction, because the
    // one outcome this screen must never produce is a press that says nothing.
    void copyRecoveryCodes(clipboard, codes).then((outcome) => {
      setNote(outcome === "copied" ? t("recovery.copied") : t("recovery.copyFailed"));
    });
  }, [codes]);

  return (
    <>
      {/* A list, so a screen reader announces "list, ten items" and can walk them one by
          one, and monospace with tabular figures because a recovery code is transcribed by
          hand and `1`/`l` and `0`/`O` have to be distinguishable. Both are from the screen's
          original a11y notes and neither changes here. */}
      <ul
        aria-label={t("recovery.listLabel")}
        className="grid grid-cols-2 gap-2 rounded border border-(--color-border) bg-(--color-background-muted) p-3 font-mono text-sm tabular-nums text-(--color-text)"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onPress={copy}>
          {t("recovery.copy")}
        </Button>
        {/* The testid is on the region itself rather than on its contents, so the `aria-live`
            can be asserted directly and so an empty region is still addressable (#368). */}
        <p
          aria-live="polite"
          data-testid="qcms-recovery-copy-status"
          className="text-sm text-(--color-text-muted)"
        >
          {note}
        </p>
      </div>
    </>
  );
}
