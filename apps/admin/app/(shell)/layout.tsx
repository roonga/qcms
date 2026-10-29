import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AccountMenu } from "@/components/account-menu";
import { Announcer } from "@/components/announcer";
import { EnvironmentBanner } from "@/components/environment-banner";
import { EnvironmentScope } from "@/components/environment-scope";
import { EnvironmentSwitcher } from "@/components/environment-switcher";
import { MeasuredMain } from "@/components/measured-main";
import { ShellChrome } from "@/components/shell/shell-chrome";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopbarHeight } from "@/components/topbar-height";
import { MODE_COOKIE, parseAppearance } from "@/lib/appearance";
import { shownEnvironment } from "@/lib/environment";
import { secureCookies } from "@/lib/server/config";
import { resolvedEnvironment } from "@/lib/server/environments";
import { t } from "@/lib/i18n/en";
import { navigableCapabilities, rememberedMode, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The authenticated shell (task 031; screen contract "ASCII sketch - authenticated shell").
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
   * WHY A SLOT RATHER THAN A COMPONENT THIS LAYOUT RENDERS. The rail is per-object data - a
   * form's steps and its per-step issue counts, a question's versions - and a Next layout is
   * never told which child route rendered, let alone which `[formId]` it carried. So the
   * layout cannot fetch it. A parallel route can: `@rail/forms/[formId]/links/page.tsx` is
   * matched against the same URL as the page it accompanies, gets the same params, and
   * renders beside `<main>` instead of inside it.
   *
   * EVERY ROUTE HAS A PAGE IN THE SLOT, AND THAT IS A CORRECTNESS REQUIREMENT RATHER THAN
   * TIDINESS. Every route has a page here, because on
   * a soft navigation Next keeps the previously active state of a slot the new URL does not
   * match and consults `default.tsx` only after a full-page load - the file convention's own
   * reference says so. A screen with no match therefore did not get an empty rail: it got
   * the PREVIOUS screen's, and walking from Settings to the question library left the
   * Settings rail standing beside a table it says nothing about.
   *
   * Every page renders a rail (§7.0 ruling 1). `lib/rail-routes.test.ts` reads both trees
   * off the filesystem and fails the moment one has a route the other does not.
   *
   * WHY IT MATTERS THAT IT IS BESIDE `<main>` AND NOT INSIDE IT. `<main>`'s width is capped
   * per route (issue 558), and §6 asks that width question about the CONTENT column. A rail
   * nested inside that cap would make the cap govern rail-plus-content instead, quietly
   * taking 240px off the measure every screen was assigned and standing the rail on
   * `<main>`'s padding rather than on the shell's edge. Outside it, the two systems compose
   * the way both documents describe.
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
  const cookieStore = await cookies();
  const appearance = parseAppearance(cookieStore.get(MODE_COOKIE)?.value);
  // Which areas this caller has, so the navigation offers no area that would refuse. A
  // read that failed is not a refusal: `navigableCapabilities` narrows nothing then, and
  // every route behind an entry decides for itself.
  const accessPromise = shellAccess(session);
  // The environment set is the API's answer, not a literal here (ADR-40: the set is a
  // table and an operator may add to it), and the selection is validated against it so a
  // cookie naming an environment this deployment no longer serves falls through to
  // production rather than being carried into every screen's reads.
  // Since task 069 this read is already narrowed to **the environments the caller holds
  // in some grant** (Q25), by the API rather than here: a switcher is one client of that
  // route, and a second client reading the whole set would see round a narrowing done in
  // the first.
  // It is the request's ONE resolution (local UX list A12), the same answer the API header
  // carries, so the chrome cannot say `prod` while the screen reads another environment. A
  // read of the set that failed is `unknown`, never `prod`: the banner says so, the
  // switcher has nothing to offer, and environment-sensitive actions are disabled here and
  // refused by their server actions.
  // Issued together with the capability read above, not after it: both are API round trips
  // on every page in the app, and awaiting them in sequence puts one of them on the
  // critical path of every render for nothing.
  const [access, resolved] = await Promise.all([accessPromise, resolvedEnvironment(session)]);
  const capabilities = navigableCapabilities(access);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* The one live region every authenticated screen speaks into (issue #355). It is
          here, above the page, because an action that revalidates its own route unmounts
          the screen that performed it - and a region taken out of the document mid
          announcement says nothing. See `components/announcer.tsx`. */}
      <Announcer />
      {/* The bar below WRAPS, and the page's scroll padding has to know how far (issue
          #1011). The nav is this row's elastic member, so at narrow widths its items take
          further lines and the bar is 145px rather than the 57px `--admin-topbar-h`
          derives - and that token is what reserves room for the sticky bar when the
          browser scrolls a control into view (WCAG 2.2 SC 2.4.11). This measures the bar
          and publishes the number; `app/globals.css` prefers it and falls back to the
          token. Layout is untouched: scroll padding paints nothing. */}
      <TopbarHeight />
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

            THE INLINE PADDING IS THE TOKEN THE POC DRAWS, and it is one value spent in
            two places (issue 675). Every POC declares `--admin-section-pad: 1.25rem` at
            its `:45` and then spends it in both - `padding: 0 1.25rem` on this row,
            `padding: var(--admin-section-pad)` on `.main` - and that single value is HOW
            the drawings get the shared left edge 648 asks for: the bar's first item and
            the column's content both start 20px from the page edge.

            Issue 648 landed that shared edge at `px-6` on both instead, matching this
            app's own `p-6` column rather than the drawing, and recorded the 4px as a
            deviation rather than burying it. Issue 675 is that 4px. What moved is the
            value, not the property: `lib/measure.ts`'s `mainClassFor` spends the same
            token on `<main>`, so the edge is still one edge and it is now the drawn one.
            The footer that used to carry the third copy of this number is gone (Code
            Owner decision, 2026-08-23), so there are two call sites rather than three. */}
        <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-(--admin-section-pad) py-2">
          {/* "QCMS" and nothing else. No sub-label, and no word here names this app
              to an operator: the product is QCMS and the respondent app is the
              Portal (Code Owner naming call, 2026-07-30). */}
          <span className="qcms-wordmark flex-shrink-0">{t("app.title")}</span>
          <ShellChrome
            capabilities={capabilities}
            rememberedMode={rememberedMode(cookieStore)}
            secureCookies={secureCookies()}
            trailing={
              <>
                {/* The one global environment control (Q6). First in the trailing group,
                because it is the widest-reaching of the three: appearance changes how a
                screen looks and the account menu is about who is signed in, while this one
                changes which rows every screen is showing. */}
                {resolved.status === "known" ? (
                  <EnvironmentSwitcher
                    environments={resolved.environments}
                    selected={resolved.environment}
                    secureCookies={secureCookies()}
                  />
                ) : (
                  // Nothing to offer: the set is what the menu lists, and it could not be read.
                  // Not a button, because pressing it could do nothing.
                  <div
                    className="qcms-envswitch"
                    data-testid="qcms-environment-switcher"
                    data-environment=""
                    data-nonprod="true"
                    data-pending="false"
                  >
                    <span className="qcms-envtrigger qcms-envtrigger--static">
                      {t("environment.unknown")}
                    </span>
                  </div>
                )}
                <ThemeToggle appearance={appearance} secureCookies={secureCookies()} />
                <AccountMenu email={session.email} name={session.name} />
              </>
            }
          />
        </div>
        {/* The persistent banner (Q6), INSIDE the sticky bar rather than under it, which
            is two properties for one decision: it stays on screen while the operator
            scrolls, and `TopbarHeight` measures the bar it is part of, so the page's scroll
            padding already accounts for it and SC 2.4.11 holds with no second measurement.
            Absent under `prod`, which is what makes its presence information rather than
            furniture. */}
        <EnvironmentBanner environment={shownEnvironment(resolved)} />
      </header>
      {/* The shell body: the rail's track and the content column, and the thing that grows
          to fill whatever height the topbar leaves (issue 559, and N2 of
          `plan/admin-redesign-implementation-plan.md` §1). Without a rail it is a flex
          column and `<main>`'s own `flex-1` keeps stretching it exactly as before; with
          one, and at `--bp-sidebar` and above, it is the two-track grid §7 describes.
          `app/globals.css` holds both, keyed off whether a rail is actually a child.

          IT IS ALSO THE LAST THING ON THE PAGE NOW. A footer used to sit below both tracks
          carrying "Signed in as ...", and that strip is what stopped a rail reaching the
          bottom of the screen: the rail ended where this element ended and the footer sat
          under it. The email is shell chrome rather than a credential and it was never only
          here - the account menu carries it on every screen - so the line went rather than
          moving somewhere it would have been absent half the time (Code Owner decision).

          Every screen has a rail (§7.0 ruling 1), so above `--bp-sidebar` the grid branch
          always renders; the flex fallback is what every width below it takes. */}
      {/* What every environment-sensitive control below reads to disable itself while the
          environment is unknown, and the watcher that re-reads this tab when it comes back
          into view under a selection another tab changed (local UX list A1, A12). */}
      <EnvironmentScope selection={resolved.selection} unknown={resolved.status === "unknown"}>
        <div className="qcms-shell-body">
          {rail}
          {/* The content column's cap is set by the ROUTE, not by one number here (issue
              558, `plan/admin-ux-audit.md` §6): five screens earn width, two render
              respondent-facing content and take less than the default, nine keep the
              measure they have. The sixteen answers are one table in `lib/measure.ts`;
              `MeasuredMain` only applies the row that matches the pathname. */}
          <MeasuredMain>{children}</MeasuredMain>
        </div>
      </EnvironmentScope>
    </div>
  );
}
