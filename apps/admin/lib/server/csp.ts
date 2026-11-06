/** Next inlines its RSC bootstrap; its nonce must come from the request CSP as well as the response CSP. Allow inline styles for Tailwind, never inline scripts; data images support enrollment QR codes. */
export function buildAdminCsp(nonce: string): string {
  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,

    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `img-src 'self' data:`,
    `style-src 'self' 'unsafe-inline'`,
    `script-src 'self' 'nonce-${nonce}'${devScriptSrc()}`,
    `connect-src 'self'`,
    `frame-src 'none'`,
    // Both already resolve to this through `default-src`; naming them keeps the installable surface
    // stated rather than incidental.
    `worker-src 'self'`,
    `manifest-src 'self'`,
  ];
  return directives.join("; ");
}

/** next dev needs eval for sourcemaps and Fast Refresh; production builds inline NODE_ENV and exclude it. */
function devScriptSrc(): string {
  return process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
}
