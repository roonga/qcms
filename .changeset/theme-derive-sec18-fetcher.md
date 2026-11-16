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
  type, and caps on bytes, decompressed bytes, time and pixels. Every refusal is one uniform
  `THEME_DERIVE_REFUSED`.
- The output is hex colours, a registry face and a logo key, with no page text.
- Optional `QCMS_THEME_DERIVE_ALLOWED_HOSTS` and `QCMS_THEME_DERIVE_PROXY` narrow egress.
- Per-user and per-workspace rate limits, and one `derive` audit row per fetch, with the host.
- Every logo, derived or uploaded by hand, is decoded, held to a pixel cap and re-encoded as
  PNG. A hand upload the decoder cannot read is now refused with `LOGO_NOT_RASTER`, and one
  over the cap with `LOGO_TOO_MANY_PIXELS`.
- The OTLP log allowlist exports the `theme derive refused` event name; its reason and host
  stay off the export.
