"use client";

import { useRef } from "react";

import { Menu } from "@/components/kit";
import { menuClasses } from "@/components/menu-slots";
import { t } from "@/lib/i18n/en";
import { initialsFor } from "@/lib/initials";

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
 * IT IS THE VENDORED `Menu`, SINCE ISSUE #234
 * It was composed from react-aria-components' popup primitives until then, because
 * the registry component had no slot for a monogram trigger, a "Signed in as" header
 * or a link row. Upstream now ships all three, so this is the registry component
 * again: `header` renders outside `role="menu"` and brings its own rule with it, and
 * an item with an `href` is a real anchor exactly as the hand-composed one was.
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

export function AccountMenu({ email, name }: { readonly email: string; readonly name?: string }) {
  const signOutForm = useRef<HTMLFormElement>(null);

  return (
    <div className="qcms-account" data-testid="account-menu">
      <Menu
        triggerLabel={t("account.trigger", { email })}
        /* Decorative, and hidden from the accessibility tree on purpose: the
           accessible name is `triggerLabel` above, and two letters sitting beside it
           as visible text would be a WCAG 2.5.3 mismatch the moment a display name's
           initials stop appearing in the address. */
        trigger={<span aria-hidden="true">{initialsFor(email, name)}</span>}
        menuLabel={t("account.menuLabel")}
        /* Outside the menu rather than inside it, which the slot guarantees: this is
           a label for the menu, not a stop in it, and a menu whose first arrow-down
           landed on an inert row would be a worse keyboard experience than one that
           starts on the first real action. The rule under it comes with the slot. */
        header={
          <>
            <span className="qcms-menu__who">{t("account.signedInAs")}</span>
            <span className="qcms-menu__email">{email}</span>
          </>
        }
        classNames={menuClasses("qcms-avatar")}
        onAction={(key) => {
          if (key === "sign-out") signOutForm.current?.requestSubmit();
        }}
        items={[
          // A real anchor, so it behaves like a link (middle-click, copy address) and
          // needs no router. The settings screen anchors the password card.
          {
            id: "password",
            label: t("action.changePassword"),
            href: "/settings#change-password",
          },
          // Immediate, with no confirmation. Signing out is cheap to undo (sign back
          // in) and an operator who reached for it means it.
          { id: "sign-out", label: t("action.signOut") },
        ]}
      />
      <form ref={signOutForm} method="post" action="/sign-out" className="qcms-signout-fallback">
        <button type="submit" className="qcms-signout-fallback__button">
          {t("action.signOut")}
        </button>
      </form>
    </div>
  );
}
