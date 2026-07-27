/**
 * Content-Security-Policy builder for the admin (task 031, SEC-9). Pure and
 * unit-tested.
 *
 * Tighter than the portal's in two places, both because the admin has fewer needs:
 *
 * - **No third-party origin, conditionally or otherwise.** The portal's CSP grows a
 *   challenge origin when Turnstile is active; the admin has no such surface, so
 *   `connect-src` and `frame-src` never name anything but `'self'` / `'none'`.
 * - **No nonce.** The admin ships no inline script of its own (the root layout has no
 *   theme bootstrap - see `app/layout.tsx`), so `script-src` is plain `'self'` and
 *   nothing here has to thread a per-request value. That is a strictly stronger policy
 *   than a nonce-bearing one and it removes the whole nonce-propagation problem the
 *   portal has to solve (issue #20).
 *
 * `'unsafe-inline'` appears for **styles only**, because Tailwind injects a
 * stylesheet; it is never granted to script. `img-src` allows `data:` for the inline
 * QR code on the enrollment screen, which is generated in-process and never fetched.
 *
 * The admin is same-origin with its own BFF and sends NO CORS headers, ever (SEC).
 */
export function buildAdminCsp(): string {
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
    `script-src 'self'`,
    `connect-src 'self'`,
    `frame-src 'none'`,
  ];
  return directives.join("; ");
}
