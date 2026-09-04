/**
 * The colour-mode bootstrap: the nonced inline script `app/layout.tsx` puts in
 * `<head>` so the root class is correct before the first paint (task 053,
 * ADR-30).
 *
 * It lives in its own module rather than inside `app/layout.tsx` because it is the
 * one piece of the appearance chain whose behaviour can only be proven by RUNNING
 * it: everything else resolves in TypeScript the tests can call, while this is
 * generated source. `mode-bootstrap.test.ts` executes the emitted string against
 * stub globals, so the precedence chain is covered below the browser (ADR-23) and
 * `e2e/appearance.pw.ts` proves the same chain in a real browser, with the
 * first-frame no-flash measurement that only a browser can make.
 */

import { APPEARANCE_MODES, MODE_COOKIE, type AppearanceMode } from "../appearance";

import type { PortalMode } from "./theme";

/**
 * The three colour modes of the token contract (ADR-30), as a JS array literal.
 * Sourced from `APPEARANCE_MODES` so the script can never drift from the parsers
 * and class names the rest of the app uses: a second accepted-values list is
 * exactly how issue #197 happened.
 */
const MODE_CLASS_LIST = `['${APPEARANCE_MODES.join("','")}']`;

/**
 * Colour-mode bootstrap (runs before first paint, so no flash).
 *
 * Mode is the ONE axis that still needs a script, and it is worth being precise
 * about why, because font and density deliberately do not have one. All three
 * choices are cookies, so the server resolves them and stamps the root classes
 * into the first byte of HTML - no script, no flash, nothing to correct. But mode
 * has a fourth input the server cannot see: the respondent's OS signals. Only the
 * browser knows `prefers-color-scheme` and `prefers-contrast`, so when there is no
 * explicit choice to honour, this script is the only thing that can apply them,
 * and it runs synchronously in `<head>` so it does so before anything is painted.
 *
 * Priority: an explicit `?mode=` URL param, then the `qcms-theme` cookie, then -
 * only when the deployment's configured default is `auto` - the OS signals, and
 * otherwise the configured mode. `auto` is precisely the config value that means
 * "ask the OS", so a deployment that pins a mode is not second-guessed here.
 *
 * EVERY DOOR IS A FALLBACK FOR THE ONE ABOVE IT (issue #197). A layer only wins
 * when it yields a KNOWN mode: `?mode=potato` and a hand-edited `qcms-theme=potato`
 * both fall through to the next input rather than resolving to Light. Treating
 * "present" as "decided" made a malformed link stronger than a valid cookie, which
 * silently discarded a respondent's High-contrast choice - the one choice least
 * able to be shrugged off. That is why `p()` below guards the param and the cookie
 * read rather than a single validity check at the end of the chain.
 *
 * Among the OS signals, `prefers-contrast: more` wins over
 * `prefers-color-scheme: dark`. A contrast preference is an accessibility need
 * stated by someone who went into their system settings to state it; a colour
 * preference is usually comfort. Honouring the weaker signal first would hand a
 * respondent who asked for more contrast a dark theme instead.
 *
 * It only toggles a class on `<html>`; the token values live in theme.css. This is
 * theme chrome, not client data state (ADR-26 keeps the portal fetch-only).
 * `forced-colors` / Windows High Contrast Mode is a separate baseline (issue #28)
 * and is deliberately NOT read here.
 *
 * @param configuredMode the deployment default (`QCMS_PORTAL_MODE`), `auto` included
 * @param cookieMode the mode this render already stamped from the request's cookie,
 *   or `null` when the request carried no valid choice
 */
export function modeBootstrapScript(
  configuredMode: PortalMode,
  cookieMode: AppearanceMode | null,
): string {
  // `configuredMode` is one of four literals validated by `portalMode()` and
  // `cookieMode` one of three or null, so the interpolations below cannot carry
  // anything but a known keyword.
  const osFallback = "(c?'hc':d?'dark':'light')";
  const fallback = configuredMode === "auto" ? osFallback : `'${configuredMode}'`;
  // The server already stamped the cookie's mode, so re-reading the cookie here
  // would be redundant work in the common case. It is still read, and it is read
  // FIRST, because a cookie written by the controls after this page was served (a
  // back navigation to a cached document) must not be overridden by config.
  const cookie = cookieMode === null ? "null" : `'${cookieMode}'`;
  // The cookie name is interpolated from `MODE_COOKIE` for the same
  // single-sourcing reason as the mode list. It is a bare `[a-z-]` keyword, so it
  // carries no regex metacharacter into the pattern.
  return `(function(){try{
var v=${MODE_CLASS_LIST};
var p=function(x){return v.indexOf(x)<0?null:x;};
var q=p(new URLSearchParams(location.search).get('mode'));
var k=document.cookie.match(/(?:^|; )${MODE_COOKIE}=([^;]*)/);
var b=p(k&&k[1]);
var m=window.matchMedia;
var d=m&&m('(prefers-color-scheme: dark)').matches;
var c=m&&m('(prefers-contrast: more)').matches;
var t=q||b||${cookie}||${fallback};
if(v.indexOf(t)<0)t='light';
var r=document.documentElement;
for(var i=0;i<v.length;i++)r.classList.remove(v[i]);
r.classList.add(t);
}catch(e){}})();`;
}
