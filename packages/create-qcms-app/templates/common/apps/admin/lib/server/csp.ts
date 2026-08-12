/**
 * Content-Security-Policy builder for the admin (task 031, SEC-9). Pure and
 * unit-tested.
 *
 * ## Why there is a nonce even though the admin authors no inline script
 *
 * The admin's root layout deliberately carries no inline script of its own (unlike the
 * portal, which has a theme bootstrap): the palette is QCMS's fixed Cobalt identity, so
 * light and dark are resolved by CSS alone. A plain `script-src 'self'` therefore looked
 * correct, and it is not - **Next itself inlines scripts**. The App Router streams its RSC
 * payload as a series of inline `self.__next_f.push(...)` calls, so a nonce-free policy
 * blocks all of them: measured as ten CSP violation errors per page load plus an
 * `Invariant: Expected a request ID to be defined for the document via self.__next_r`
 * page error, on a page that still *looked* fine because the server-rendered HTML was
 * already there. Hydration was simply dead.
 *
 * A nonce is the right fix rather than `'unsafe-inline'`, which would let any injected
 * inline script run. Next reads the nonce off the **request's** CSP header and stamps it
 * on the scripts it generates, which is why `proxy.ts` sets the header on both the request
 * and the response.
 *
 * ## Still tighter than the portal's
 *
 * - **No third-party origin, conditionally or otherwise.** The portal's CSP grows a
 *   challenge origin when Turnstile is active; the admin has no such surface, so
 *   `connect-src` and `frame-src` never name anything but `'self'` / `'none'`.
 * - **No `x-nonce` request header, and no nonce prop anywhere.** Nothing here needs the
 *   value in React, so the admin avoids the whole nonce-propagation and
 *   hydration-warning problem the portal has to manage (issue #20).
 *
 * `'unsafe-inline'` appears for **styles only**, because Tailwind injects a stylesheet; it
 * is never granted to script. `img-src` allows `data:` for the inline QR code on the
 * enrollment screen, which is generated in-process and never fetched.
 *
 * The admin is same-origin with its own BFF and sends NO CORS headers, ever (SEC).
 */
export function buildAdminCsp(nonce: string): string {
  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    // Every state change is a same-origin form POST, so this is exactly right and
    // also doubles as a CSRF control alongside SameSite=Lax.
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `img-src 'self' data:`,
    `style-src 'self' 'unsafe-inline'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `connect-src 'self'`,
    `frame-src 'none'`,
  ];
  return directives.join("; ");
}
