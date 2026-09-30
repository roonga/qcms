/**
 * The top bar's MEASURED height, in one place (issue #1011).
 *
 * ## Why a measured number exists beside the derived one
 *
 * `--admin-topbar-h` in `app/globals.css` is derived - one control tall, plus the row's
 * padding, plus the bar's own border - and that derivation is correct exactly while the bar
 * is one row. The bar wraps: `app/(shell)/layout.tsx` renders the wordmark, the nav and the
 * trailing controls as three siblings of one `flex-wrap` row, and the nav is the elastic
 * member, so at 390 the nav's own items wrap onto further lines and the bar measures 145px
 * against the token's 57px.
 *
 * Nothing about the bar's LAYOUT depends on the token being wrong there, because the two
 * places that spend it on layout - the rail's sticky offset and its height - are inside
 * `@variant sidebar`, where the bar is one row by construction. What does depend on it is
 * `scroll-padding-block-start`, which is what keeps a control the browser scrolls INTO view
 * from landing underneath the sticky bar (WCAG 2.2 SC 2.4.11 Focus Not Obscured). At 390 it
 * reserved 57px against a 145px bar, so a control focused from further down the page landed
 * 88px behind it: entirely hidden, which is the Minimum failure and not only the Enhanced
 * one.
 *
 * ## Why measured rather than a media query
 *
 * A width is a guess about how many rows the nav takes, and the guess goes stale on a
 * longer label, a second locale, or a different density. The bar's height is a fact the
 * browser already knows, and `ResizeObserver` is how it is asked. The admin requires
 * JavaScript (Code Owner, 2026-09-27), so this is not a capability the page has to earn.
 *
 * ## Why it cannot flash or shift
 *
 * Scroll padding is not layout: it changes where a scroll comes to rest and nothing about
 * where anything is painted, so publishing it after first paint moves nothing on screen.
 * And the CSS reads it as `var(--admin-topbar-measured-h, var(--admin-topbar-h))`, so
 * before the first measurement the rule is exactly the rule that shipped.
 *
 * ## Why this module holds no React import
 *
 * The same reason `lib/hydration.ts` holds none: the two things that have to agree on these
 * strings are a mount effect inside the browser and a Playwright spec in a Node runner
 * (`e2e/focus-not-obscured.pw.ts`). Two literals would compile, review cleanly, and stop
 * agreeing the day either is edited.
 */

/**
 * The custom property `components/topbar-height.tsx` publishes on `<html>`, holding the top
 * bar's rendered border-box height in pixels.
 *
 * Absent until the probe's first measurement, which is what makes the CSS fallback to
 * `--admin-topbar-h` meaningful rather than dead.
 */
export const TOPBAR_HEIGHT_PROPERTY = "--admin-topbar-measured-h";

/** The bar itself: `app/(shell)/layout.tsx`'s `<header>`, styled by `app/globals.css`. */
export const TOPBAR_SELECTOR = "header.qcms-topbar";
