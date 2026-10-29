import { APPEARANCE_MODES, MODE_COOKIE, type AppearanceMode } from "../appearance";

import type { PortalMode } from "./theme";

/**
 * Sourced from `APPEARANCE_MODES` so the script cannot drift from the parsers and class
 * names the rest of the app uses.
 */
const MODE_CLASS_LIST = `['${APPEARANCE_MODES.join("','")}']`;

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
