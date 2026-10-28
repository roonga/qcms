/**
 * The nonced inline script `app/layout.tsx` puts in `<head>` so the root class is
 * correct before the first paint (ADR-30).
 *
 * Its own module because it is the one piece of the appearance chain whose behaviour can
 * only be proven by running it, and `mode-bootstrap.test.ts` executes the emitted string
 * against stub globals.
 */

import { APPEARANCE_MODES, MODE_COOKIE, type AppearanceMode } from "../appearance";

import type { PortalMode } from "./theme";

/**
 * Sourced from `APPEARANCE_MODES` so the script cannot drift from the parsers and class
 * names the rest of the app uses.
 */
const MODE_CLASS_LIST = `['${APPEARANCE_MODES.join("','")}']`;

/**
 * Mode is the one axis that still needs a script, because it has a fourth input the
 * server cannot see: only the browser knows `prefers-color-scheme` and
 * `prefers-contrast`. Font and density are cookies the server resolves, so they need
 * none.
 *
 * Priority: an explicit `?mode=` parameter, then the cookie, then the OS signals when
 * the configured default is `auto`, and otherwise the configured mode.
 *
 * Every door is a fallback for the one above it: a layer wins only when it yields a known
 * mode, so a malformed parameter cannot be stronger than a valid cookie and silently
 * discard a respondent's High contrast choice. That is why `p()` guards each read rather
 * than one validity check at the end.
 *
 * Among the OS signals, `prefers-contrast: more` wins over `prefers-color-scheme: dark`:
 * a contrast preference is a need somebody stated in their system settings, where a
 * colour preference is usually comfort.
 *
 * `forced-colors` is a separate baseline and is deliberately not read here.
 *
 * @param configuredMode the deployment default, `auto` included
 * @param cookieMode the mode this render already stamped, or `null` for none
 */
export function modeBootstrapScript(
  configuredMode: PortalMode,
  cookieMode: AppearanceMode | null,
): string {
  // Both arguments are validated keywords, so no interpolation below can carry anything
  // but a known literal into the generated source.
  const osFallback = "(c?'hc':d?'dark':'light')";
  const fallback = configuredMode === "auto" ? osFallback : `'${configuredMode}'`;
  // The live cookie is read first, although the server already stamped its mode, because
  // a cookie the controls wrote after this page was served must not be overridden by
  // config on a back navigation to a cached document.
  const cookie = cookieMode === null ? "null" : `'${cookieMode}'`;
  // `MODE_COOKIE` is a bare keyword, so it carries no regex metacharacter into the
  // pattern below.
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
