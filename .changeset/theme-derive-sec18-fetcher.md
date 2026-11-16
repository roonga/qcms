---
"@roonga/qcms-observability": patch
"create-qcms-app": minor
---

Derive a workspace theme from a website (task 110, criterion 119, SEC-18).

- `POST /admin/workspaces/{id}/themes/derive`, for Edit forms holders, behind its own
  `QCMS_FLAG_THEME_DERIVE`, off by default and separate from the agent flag. With it off the
  route is 404.
- The `BrandFetcher` port: https on 443 only, no userinfo, every A and AAAA record public
  (mapped and NAT64 forms included), the connection pinned to the checked address with the
  certificate verified for the host, one same-site redirect re-validated, a sniffed content
  type, and caps on bytes, decompressed bytes, time and pixels. Every refusal of the page or a
  stylesheet is one uniform `THEME_DERIVE_REFUSED`; a refused logo is left out and the derive
  goes on with `logoKey: null`.
- The output is hex colours, a registry face and a logo key, with no page text.
- Optional `QCMS_THEME_DERIVE_ALLOWED_HOSTS` and `QCMS_THEME_DERIVE_PROXY` narrow egress.
- Per-user and per-workspace rate limits, and one `derive` audit row per host contacted
  (the typed host, a redirect target, a stylesheet's and the logo's), written before it is.
- Every logo, derived or uploaded by hand, is decoded, held to a pixel cap and re-encoded as
  PNG. Only a PNG or a JPEG is accepted. A hand upload the decoder cannot read is now refused
  with `LOGO_NOT_RASTER`, one over the cap with `LOGO_TOO_MANY_PIXELS`, and a WebP or an
  interlaced PNG with the new `LOGO_UNSUPPORTED`.
- The OTLP log allowlist exports the `theme derive refused` and `theme derive logo dropped`
  event names; their reason and host stay off the export.
