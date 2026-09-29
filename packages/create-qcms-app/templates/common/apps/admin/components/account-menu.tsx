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
 * SIGN-OUT IS A POST, AND THAT IS WHAT THE FORM BELOW IS FOR
 * `requestSubmit()` on a real `<form method="post">` is a navigation-producing POST
 * to `/sign-out`, which is the route SEC-1's server-side session invalidation
 * covers. A GET link would have let a prefetch or a crawler end someone's session,
 * which is why it was never one, and a `fetch` would put a state change in client
 * JavaScript for no gain. So the form stays even though nothing in it is ever on
 * screen: it is the mechanism, not an affordance.
 *
 * `hidden` rather than a CSS class. The attribute takes the element out of the
 * accessibility tree and out of the tab order, and neither `hidden` nor
 * `display: none` stops `requestSubmit()`. There is no styling left to carry,
 * because there is nothing left to look at.
 *
 * THE NO-JS FALLBACK BUTTON IS GONE (Code Owner, 2026-09-27)
 * This form used to carry a visible submit button that a `<noscript>` rule in
 * `app/layout.tsx` revealed while hiding the two menu triggers, so that a scriptless
 * operator could still END A SESSION (Code Owner decision, 2026-07-31). The admin
 * requires JavaScript now and stops at one message without it
 * (`plan/admin-design-contracts.md`), so no scriptless operator reaches this topbar
 * at all and the button was a control nothing could ever show. That 2026-07-31
 * decision is superseded rather than quietly dropped; the record says so.
 *
 * The appearance control staying JavaScript-only was always a different case and is
 * unaffected: a preference is not a session.
 */

export function AccountMenu({ email, name }: { readonly email: string; readonly name?: string }) {
  const signOutForm = useRef<HTMLFormElement>(null);
  // Computed once and used twice on purpose. These two letters are BOTH what the disc
  // paints and the opening words of the accessible name, and WCAG 2.5.3 is a statement
  // about the two being the same characters. Deriving them separately on each side is
  // exactly how they drift apart again.
  const initials = initialsFor(email, name);

  return (
    <div className="qcms-account" data-testid="account-menu">
      <Menu
        /* The accessible name OPENS with the initials the disc paints, then says which
           account the menu belongs to: "AD, account menu for dev@qcms.test" (Code Owner,
           2026-09-29, issue #1010). WCAG 2.2 SC 2.5.3 requires the visible text to be part
           of the name, and speech input needs it at the front, so the catalogue message
           takes the initials as a placeholder rather than naming the account alone. */
        triggerLabel={t("account.trigger", { initials, email })}
        /* `aria-hidden` because `triggerLabel` above already REPLACES this content in the
           name computation, so leaving it exposed would add nothing and risk a doubled
           announcement. It is not what satisfies 2.5.3, and the comment here claimed it
           was until issue #1010: hiding text from the accessibility tree does not unpaint
           it, the criterion is about what a sighted operator can read, and axe reports
           `label-content-name-mismatch` on this node regardless of the attribute. What
           satisfies the criterion is the name starting with these same characters. */
        trigger={<span aria-hidden="true">{initials}</span>}
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
      <form ref={signOutForm} method="post" action="/sign-out" hidden />
    </div>
  );
}
