---
"create-qcms-app": minor
---

The scaffolded admin is installable, with a service worker that exists only to offer the update.

- `app/manifest.ts` declares a standalone window opening at `/questions`, with the page and accent colours of the generated theme.
- `app/apple-icon.tsx` and `app/pwa-icon-192`/`-512` draw the mark from `lib/pwa/icon-mark.tsx`, so no new image file is scaffolded. Both PNGs are listed under `any` and `maskable`.
- `app/sw.js/route.ts` serves the worker with `Cache-Control: no-cache`. It registers no `fetch` handler and opens no cache, so nothing an operator sees is stored.
- `components/app-update.tsx` offers a reload when a replacement worker is waiting, and posts `SKIP_WAITING` only on that press.
- The scaffolded CSP gains `worker-src 'self'` and `manifest-src 'self'`, both of which already resolved to this origin through `default-src 'self'`.
