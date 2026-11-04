import { redirect } from "next/navigation";
import QRCode from "qrcode";
import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth-screen";
import { Button, TextField } from "@/components/kit";
import { authFailureMessage } from "@/lib/auth-failure-message";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { pendingEnrollment } from "@/lib/server/enrollment";
import { requireEnrollingSession, SIGN_IN_PATH } from "@/lib/server/session";

export function generateMetadata(): Metadata {
  return pageMetadata(t("enroll.title"));
}

/* Render QR SVG inline server-side so no image URL carries the TOTP secret into logs; the labelled key is
   its accessible alternative. */
export default async function EnrollPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireEnrollingSession();
  const error = authFailureMessage(await searchParams);

  const totpUri = await pendingEnrollment();
  if (totpUri === undefined) redirect(`${SIGN_IN_PATH}?expired=1`);

  const secret = new URL(totpUri).searchParams.get("secret") ?? "";
  const qrSvg = await QRCode.toString(totpUri, {
    type: "svg",
    // The QR code's own light quiet zone must survive every theme; a wrapper background cannot guarantee it.
    margin: 2,
    width: 200,
  });

  return (
    <AuthScreen title={t("enroll.title")} intro={t("enroll.intro")} error={error}>
      <div
        aria-hidden="true"
        className="qcms-qr"
        // This SVG comes only from the server-generated otpauth URI; no user-supplied markup enters it.
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <TextField
        label={t("enroll.manualLabel")}
        value={secret}
        isReadOnly
        // The setup key is not a completable field; browsers must never offer to remember it.
        autoComplete="off"
      />
      <form method="post" action="/two-factor/enroll/verify" className="flex flex-col gap-4">
        <TextField
          name="code"
          label={t("enroll.codeLabel")}
          inputMode="numeric"
          autoComplete="one-time-code"
          isRequired
        />
        <Button type="submit" variant="primary" size="md">
          {t("action.verify")}
        </Button>
      </form>
    </AuthScreen>
  );
}
