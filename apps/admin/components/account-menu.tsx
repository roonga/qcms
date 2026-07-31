"use client";

import { useRef } from "react";

import {
  MenuItem,
  MenuList,
  MenuPopover,
  MenuSeparator,
  MenuTrigger,
  MenuTriggerButton,
} from "@/components/kit";
import { t } from "@/lib/i18n/en";

/**
 * The account control in the topbar's trailing group (task 032).
 *
 * It absorbs the standalone Sign out button (Code Owner call, 2026-07-31, recorded
 * in `plan/admin-theme/ds-navbar.html`, "Account menu"): the trigger is a circular
 * initials monogram, and the menu carries the full email, Change password, and Sign
 * out. The circle is a deliberate, documented exception to this app's sharp-corner
 * character - an identity glyph is not a control surface, and the same disc takes an
 * avatar image later without a layout change if one ever ships.
 *
 * No external avatar service, and no image today. The app makes zero off-origin
 * requests by design (`lib/server/csp.ts`), and an operator has nothing to upload.
 *
 * WHERE THE EMAIL WENT
 * Into the menu's "Signed in as" row, which is why the trigger can be two letters.
 * The email is shell chrome, not a credential - it tells an operator which account
 * is acting when several people share a screen - and it stays in the footer too.
 *
 * SIGN-OUT SURVIVES WITHOUT JAVASCRIPT (Code Owner decision, 2026-07-31)
 * Sign-out was a plain `<form method="post">` before this task and worked with
 * JavaScript off; a menu is JavaScript by definition, so moving it inside one would
 * have taken away the ability to END A SESSION on a machine where scripts are
 * blocked. `docs/COMPONENT_GUIDELINES.md` step 7 allows wiring the no-JS path or
 * recording an explicit exception, and the decision was to wire it: that form is
 * still rendered, on every page, and `<noscript>` reveals it while hiding the two
 * menu triggers (`app/layout.tsx`). Nothing is deferred and no exception is
 * recorded. The appearance control staying JavaScript-only is a different case and
 * is accepted: a preference is not a session.
 *
 * The scripted path submits that same form rather than fetching. `requestSubmit()`
 * is a real navigation-producing POST to the same route the no-JS button posts to,
 * so there is exactly one sign-out path in this app and it is the one SEC-1's
 * server-side session invalidation already covers. A GET link would have let a
 * prefetch or a crawler end someone's session, which is why it was never one.
 *
 * The form is hidden with CSS rather than by not rendering it, so nothing has to
 * know whether scripts ran, and `display: none` does not stop `requestSubmit()`.
 */

/**
 * Two letters for the disc: initials of the display name, or of the email's local
 * part when there is no name (`op@example.test` gives `OP`).
 *
 * Deliberately not clever about it. Splitting on the separators people actually use
 * in an address (`.`, `_`, `-`, `+`) covers `ada.lovelace@` and `ada_lovelace@`;
 * anything else falls back to the first two characters, which is always SOMETHING
 * rather than a blank circle. The result is decorative - `aria-label` carries the
 * accessible name - so an imperfect guess costs nobody anything.
 */
export function initialsFor(email: string, name?: string): string {
  const source = name !== undefined && name.trim() !== "" ? name : (email.split("@")[0] ?? email);
  const parts = source.split(/[\s._\-+]+/u).filter((part) => part !== "");
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  return (parts[0] ?? source).slice(0, 2).toUpperCase();
}

export function AccountMenu({ email, name }: { readonly email: string; readonly name?: string }) {
  const signOutForm = useRef<HTMLFormElement>(null);

  return (
    <div className="qcms-account" data-testid="account-menu">
      <MenuTrigger>
        <MenuTriggerButton className="qcms-avatar" aria-label={t("account.trigger", { email })}>
          {/* Decorative, and hidden from the accessibility tree on purpose: the
              accessible name is the whole sentence above, and two letters sitting
              beside it as visible text would be a WCAG 2.5.3 mismatch the moment a
              display name's initials stop appearing in the address. */}
          <span aria-hidden="true">{initialsFor(email, name)}</span>
        </MenuTriggerButton>
        <MenuPopover className="qcms-menu">
          {/* Outside the menu rather than inside it: this is a label for the menu,
              not a stop in it, and a menu whose first arrow-down landed on an inert
              row would be a worse keyboard experience than one that starts on the
              first real action. */}
          <div className="qcms-menu__info" role="presentation">
            <span className="qcms-menu__who">{t("account.signedInAs")}</span>
            <span className="qcms-menu__email">{email}</span>
          </div>
          <MenuSeparator className="qcms-menu__sep" />
          <MenuList
            className="qcms-menu__list"
            aria-label={t("account.menuLabel")}
            onAction={(key) => {
              if (key === "sign-out") signOutForm.current?.requestSubmit();
            }}
          >
            {/* A real anchor, so it behaves like a link (middle-click, copy address)
                and needs no router. The settings screen anchors the password card. */}
            <MenuItem id="password" className="qcms-menu__item" href="/settings#change-password">
              {t("action.changePassword")}
            </MenuItem>
            {/* Immediate, with no confirmation. Signing out is cheap to undo (sign
                back in) and an operator who reached for it means it. */}
            <MenuItem id="sign-out" className="qcms-menu__item">
              {t("action.signOut")}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </MenuTrigger>
      <form ref={signOutForm} method="post" action="/sign-out" className="qcms-signout-fallback">
        <button type="submit" className="qcms-signout-fallback__button">
          {t("action.signOut")}
        </button>
      </form>
    </div>
  );
}
