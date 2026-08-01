import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AccountMenu } from "@/components/account-menu";
import { AdminNav } from "@/components/admin-nav";
import { AppearanceMenu } from "@/components/appearance-menu";
import { MODE_COOKIE, parseMode } from "@/lib/appearance";
import { isProduction } from "@/lib/server/config";
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
export default async function ShellLayout({ children }: { readonly children: ReactNode }) {
  const session = await requireAdminSession();
  // The topbar's mode control is a client component, so its starting selection comes
  // in as a prop from the one place that can read a cookie: here. `isProduction()` is
  // read here too, for the same reason - `lib/server/` is unreachable from a client
  // module by construction (the R2 import-surface test).
  const mode = parseMode((await cookies()).get(MODE_COOKIE)?.value);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="qcms-topbar">
        {/* Three siblings of one wrapping row, not two nested groups, and the design
            card's 390px demo is why (task 032): the nav is the only elastic member
            (`flex-1 basis-40 min-w-0`), so as the bar narrows the nav shrinks and its
            own items wrap onto further lines while the trailing controls stay on the
            top row beside the wordmark. Nested inside a "wordmark plus nav" group they
            were pushed onto a row of their own below the whole nav instead. */}
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2">
          {/* "QCMS" and nothing else. No sub-label, and no word here names this app
              to an operator: the product is QCMS and the respondent app is the
              Portal (Code Owner naming call, 2026-07-30). */}
          <span className="qcms-wordmark flex-shrink-0">{t("app.title")}</span>
          <div className="min-w-0 flex-1 basis-40">
            <AdminNav />
          </div>
          <div className="flex flex-shrink-0 items-center gap-x-2">
            <AppearanceMenu mode={mode} secureCookies={isProduction()} />
            <AccountMenu email={session.email} name={session.name} />
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 p-6">
        {children}
      </main>
      {/* The email is shell chrome, not a credential; it tells an operator which
          account is acting when several people share a screen. */}
      <footer className="mx-auto w-full max-w-5xl px-6 pb-6 text-xs text-(--color-text-muted)">
        {t("settings.signedInAs", { email: session.email })}
      </footer>
    </div>
  );
}
