---
"create-qcms-app": patch
---

The scaffolded API can send email through an SMTP relay (task 087).

- `QCMS_SMTP_*` settings, forwarded to the `api` service only. Unset leaves mail unconfigured.
- STARTTLS is required by default and certificates are always verified; plaintext SMTP is refused at boot unless `QCMS_SMTP_ALLOW_INSECURE=true` is set for a local development relay.
- New runtime dependency: `nodemailer`.
