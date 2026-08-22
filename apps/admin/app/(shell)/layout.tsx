import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AccountMenu } from "@/components/account-menu";
import { AdminNav } from "@/components/admin-nav";
import { Announcer } from "@/components/announcer";
import { AppearanceMenu } from "@/components/appearance-menu";
import { MeasuredMain } from "@/components/measured-main";
import { MODE_COOKIE, parseMode } from "@/lib/appearance";
import { secureCookies } from "@/lib/server/config";
import { t } from "@/lib/i18n/en";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The authenticated shell (task 031; wireframe "ASCII sketch - authenticated shell").
 *
 * This layout is the authentication gate for every **page** tasks 032-035 add: a page
 * placed in this route group is behind `requireAdminSession()` by construction, so a
 * new area cannot ship accidentally public. Auth screens sit outside the group, which
 * is why they are unaffected by it.
 *
 * It covers **pages only**. A Next layout wraps the page tree and never runs for a
 * `route.ts` or a `"use server"` action in the same segment: both are request handlers
 * the browser reaches directly. Being inside `(shell)` is therefore no evidence that
 * one of those authenticated, and each guards itself - a server action with
 * `requireAdminSession()`, a route handler with `requireAdminSessionForRequest()`.
 * `lib/server/shell-route-guards.test.ts` is the structural tripwire that fails when a
 * new handler here does not (issue #177); do not weaken it into a comment.
 *
 * Sign-out is a form POST rather than a link, because signing out is a state change
 * and a GET link would let a prefetch or a crawler end someone's session. It is the
 * same reason the auth screens post: no client JavaScript is involved in any
 * credential or session transition here. Task 032 moved the button into the account
 * menu without changing any of that - the form is still rendered on every page and
 * still the only sign-out path (`components/account-menu.tsx`).
 *
 * The trailing group is two controls and nothing else (task 032, design card
 * `plan/admin-theme/ds-navbar.html`): a 32px icon-only appearance trigger and a 32px
 * circular account monogram.
 */
export default async function ShellLayout({
  children,
  rail,
}: {
  readonly children: ReactNode;
  /**
   * The §7 rail's slot (issue 559), filled by the parallel route tree under `@rail`.
   *
   * WHY A SLOT RATHER THAN A COMPONENT THIS LAYOUT RENDERS. The rail is per-form data - a
   * form's steps and its per-step issue counts - and a Next layout is never told which
   * child route rendered, let alone which `[formId]` it carried. So the layout cannot
   * fetch it. A parallel route can: `@rail/forms/[formId]/links/page.tsx` is matched
   * against the same URL as the page it accompanies, gets the same params, and renders
   * beside `<main>` instead of inside it. `@rail/default.tsx` returns nothing, so the
   * fourteen screens with no rail render exactly as they did.
   *
   * WHY IT MATTERS THAT IT IS BESIDE `<main>` AND NOT INSIDE IT. `<main>`'s width is
   * capped per route (issue 558), and §6 asks that width question about the CONTENT
   * column: "roughly 976px of content after `p-6`". A rail nested inside that cap would
   * make the cap govern rail-plus-content instead, quietly taking 240px off the measure
   * nine screens were assigned and standing the rail on `<main>`'s padding rather than on
   * the shell's edge. Outside it, the two systems compose the way both documents describe:
   * the rail is a fixed track of the shell, and the cap keeps meaning what it measured.
   */
  readonly rail: ReactNode;
}) {
  const session = await requireAdminSession();
  // The topbar's mode control is a client component, so its starting selection comes
  // in as a prop from the one place that can read a cookie: here. `secureCookies()` is
  // read here too, for the same reason - `lib/server/` is unreachable from a client
  // module by construction (the R2 import-surface test) - and it is the same function
  // the enrollment cookies and the API's better-auth instance decide from, so all three
  // cookie families on this origin carry the same `Secure` attribute (see its doc).
  const mode = parseMode((await cookies()).get(MODE_COOKIE)?.value);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* The one live region every authenticated screen speaks into (issue #355). It is
          here, above the page, because an action that revalidates its own route unmounts
          the screen that performed it - and a region taken out of the document mid
          announcement says nothing. See `components/announcer.tsx`. */}
      <Announcer />
      <header className="qcms-topbar">
        {/* Three siblings of one wrapping row, not two nested groups, and the design
            card's 390px demo is why (task 032): the nav is the only elastic member
            (`flex-1 basis-40 min-w-0`), so as the bar narrows the nav shrinks and its
            own items wrap onto further lines while the trailing controls stay on the
            top row beside the wordmark. Nested inside a "wordmark plus nav" group they
            were pushed onto a row of their own below the whole nav instead. */}
        {/* THE BAR IS NOT CAPPED AND NOT CENTRED (issue 648). Every POC that draws the
            shell writes one identical rule for it, `.topbar__inner { display: flex;
            flex-wrap: wrap; align-items: center; gap: 1.25rem; padding: 0 1.25rem;
            min-height: 56px; }`, with NO `max-width` and NO auto margin - ten of the
            eleven files, the eleventh being `auth-poc.html`, which drops the shell
            deliberately and so has no bar to cap. The bar spans the viewport and its
            first item starts at the page's own inline padding.

            It carried `mx-auto max-w-5xl` until now, which put the wordmark ~145px in
            from the left edge at 1280 while the content column beside a rail started at
            24px: two unrelated layouts on one screen.

            `px-6` rather than the POC's 1.25rem because the shared left edge is the point
            and `<main>` carries `p-6`. The POC pads both by 1.25rem and so also shares
            one edge; matching on the shipped 1.5rem gets the same alignment without
            moving every screen's content padding, which neither issue asks for. */}
        <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-6 py-2">
          {/* "QCMS" and nothing else. No sub-label, and no word here names this app
              to an operator: the product is QCMS and the respondent app is the
              Portal (Code Owner naming call, 2026-07-30). */}
          <span className="qcms-wordmark flex-shrink-0">{t("app.title")}</span>
          <div className="min-w-0 flex-1 basis-40">
            <AdminNav />
          </div>
          <div className="flex flex-shrink-0 items-center gap-x-2">
            <AppearanceMenu mode={mode} secureCookies={secureCookies()} />
            <AccountMenu email={session.email} name={session.name} />
          </div>
        </div>
      </header>
      {/* The shell body: the rail's track and the content column, and the thing that
          grows to fill whatever height the topbar and footer leave (issue 559, and N2 of
          `plan/admin-redesign-implementation-plan.md` §1). Without a rail it is a flex
          column and `<main>`'s own `flex-1` keeps stretching it exactly as before; with
          one, and at `--bp-sidebar` and above, it is the two-track grid §7 describes.
          `app/globals.css` holds both, keyed off whether a rail is actually a child. */}
      <div className="qcms-shell-body">
        {rail}
        {/* The content column's cap is set by the ROUTE, not by one number here (issue
            558, `plan/admin-ux-audit.md` §6): five screens earn width, two render
            respondent-facing content and take less than the default, nine keep the
            measure they have. The sixteen answers are one table in `lib/measure.ts`;
            `MeasuredMain` only applies the row that matches the pathname. */}
        <MeasuredMain>{children}</MeasuredMain>
      </div>
      {/* The email is shell chrome, not a credential; it tells an operator which
          account is acting when several people share a screen.

          Uncapped and left-anchored for the same reason the bar above it is (issue 648),
          with one honest difference: no POC draws a page footer at all, so this follows
          the chrome it sits under rather than a drawing of its own. `px-6` puts its text
          on the same left edge as the wordmark and the content column. */}
      <footer className="w-full px-6 pb-6 text-xs text-(--color-text-muted)">
        {t("settings.signedInAs", { email: session.email })}
      </footer>
    </div>
  );
}
