// A relative import, like every other server-side module in this app: the portal's
// vitest project does not resolve the `@/` alias, and the unit test beside this page
// imports it directly.
import { t } from "../lib/i18n/en";

/**
 * The portal's error page for a failure Next answers **before** the App Router renders
 * anything (task 073, reviewed on PR #1034, finding 2).
 *
 * ## Why this file exists at all, in an App Router app
 *
 * The no-JS Add and Remove of a repeating group is a Next Server Action, and Next
 * recalculates action ids between builds: an id is keyed to the deployment. A respondent
 * with scripting off who holds a step page across a deploy posts the id the old build gave
 * them, and Next's action handler **throws before the segment renders** (error `E975`,
 * "Failed to find Server Action"). So `app/s/[sessionId]/error.tsx` is never reached: an
 * App Router error boundary catches errors thrown while rendering its own subtree, and
 * this request never gets that far. ADR-43's amendment claimed the boundary was the
 * landing; a crafted post with an unknown action id showed the framework's own 500 instead,
 * and that record is corrected.
 *
 * What Next renders for such a request is the **Pages Router error page**, which is this
 * file. It is the only hook that runs for this class of failure in Next 16.3.6, confirmed
 * by the same crafted post: with this file absent the response carried Next's built-in
 * document, and with it present the response carries these words.
 *
 * ## What it says, and why it says exactly that
 *
 * **It is the whole message the respondent gets**, so it has to be complete on its own
 * (the wording is in `lib/i18n/en.ts` with the rest). It tells them the page was out of
 * date, that every answer they had already saved is kept, that anything typed on the step
 * without saving needs typing again, and offers one way onward.
 *
 * The honesty about unsaved values is deliberate rather than cautious: an Add or Remove
 * commits no answer, so nothing the respondent had saved is at risk, but the values typed
 * into the current step since their last Continue are in the refused request's body and
 * nowhere else, so they are gone. Saying so is better than a reassurance a respondent can
 * disprove by looking at the step.
 *
 * ## No session data, and no scripting
 *
 * The page reads nothing about the session and is handed nothing: the only thing it knows
 * is the status code. The way back is a **relative** anchor, so the browser resolves it
 * against the URL the respondent is on, which for this failure is the step's own path: a
 * GET that re-reads the step from the API. No session id is written into the markup, and
 * no handler is attached, which is the point for a respondent who has no JavaScript.
 *
 * It carries no styling, and that is a choice rather than an omission. The Pages Router
 * does not load `app/globals.css`, which `app/layout.tsx` imports, so styling this page
 * would mean either a `pages/_app.tsx` that imports the app's global stylesheet into a
 * second router entry point, or inline style attributes against a nonce-based CSP. Plain
 * semantic markup renders legibly in every browser with neither cost, and this page is one
 * a respondent sees once and leaves.
 */
export default function PortalError({ statusCode }: { readonly statusCode?: number }) {
  // A 404 is the other thing that reaches this file, and it needs different words: a
  // respondent who mistyped a link has nothing out of date. Everything else, including the
  // stale action id this page exists for, reads as the skew message.
  const notFound = statusCode === 404;
  return (
    <main lang="en">
      <h1>{notFound ? t("pageMissing.title") : t("repeat.staleStep.title")}</h1>
      <p>{notFound ? t("pageMissing.body") : t("repeat.staleStep.body")}</p>
      <p>
        <a href="." data-testid="stale-step-continue">
          {t("repeat.staleStep.action")}
        </a>
      </p>
    </main>
  );
}

/**
 * The status code, read off the response Next is about to send.
 *
 * `getInitialProps` is the Pages Router's own contract for this page and the only way it
 * is handed the code; it runs on the server for this failure, since the respondent has no
 * JavaScript and there is no client navigation involved.
 */
PortalError.getInitialProps = ({
  res,
  err,
}: {
  res?: { statusCode?: number };
  err?: { statusCode?: number };
}): { statusCode: number } => ({ statusCode: res?.statusCode ?? err?.statusCode ?? 500 });
