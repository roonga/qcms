import { redirect } from "next/navigation";
import QRCode from "qrcode";

import { AuthScreen } from "@/components/auth-screen";
import { Button, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { pendingEnrollment } from "@/lib/server/enrollment";
import { requireEnrollingSession, SIGN_IN_PATH } from "@/lib/server/session";

/**
 * 2FA enrollment (task 031; screen contract state `2FA-enroll`).
 *
 * The QR code is rendered **server-side, inline, as SVG**. That is three decisions
 * at once, each worth stating:
 *
 * - *Server-side*, so the TOTP secret is encoded into markup by the same process
 *   that already holds it, rather than shipped to a client library.
 * - *Inline*, so no image request carries the secret in a URL where a proxy log or a
 *   browser history entry would keep it.
 * - *SVG*, so it stays crisp at any zoom (WCAG 1.4.4) and needs no `sharp`/canvas
 *   dependency in a Next build that deliberately has none.
 *
 * The manual setup key beside it is not a convenience: the screen contract's a11y notes
 * make it the accessible alternative to the QR image, so it is a labelled, readable,
 * selectable field rather than decoration. The QR image itself is marked
 * `aria-hidden` with the field carrying the accessible content, because a screen
 * reader announcing "QR code image" and then a separate secret is one useful item
 * and one dead end.
 *
 * A missing enrollment cookie means the fifteen-minute window lapsed (or the screen
 * was reached directly). There is nothing to show and no way to re-provision without
 * the password, so the honest answer is to send them back to sign in, which
 * re-provisions on the way through.
 */
export default async function EnrollPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireEnrollingSession();
  const error = (await searchParams).error !== undefined ? t("signIn.error") : undefined;

  const totpUri = await pendingEnrollment();
  if (totpUri === undefined) redirect(`${SIGN_IN_PATH}?expired=1`);

  const secret = new URL(totpUri).searchParams.get("secret") ?? "";
  const qrSvg = await QRCode.toString(totpUri, {
    type: "svg",
    // The quiet zone belongs to the CODE, not to a frame around it. Task 031 got it
    // with a white CSS background on the wrapper, which was the only literal colour
    // left in the app and, worse, the wrong mechanism: a scanner needs the light
    // margin whatever mode the operator is in, and the generated SVG already paints
    // its own. Two modules is the visual equivalent of the frame it replaces.
    margin: 2,
    // Fixed size rather than scale: the SVG is inlined and then constrained by CSS,
    // so the intrinsic size only needs to be large enough to stay legible.
    width: 200,
  });

  return (
    <AuthScreen title={t("enroll.title")} intro={t("enroll.intro")} error={error}>
      <div
        aria-hidden="true"
        className="qcms-qr"
        // The SVG is generated from the otpauth URI by `qrcode` in this process:
        // no user input reaches it, so there is no injection surface here.
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <TextField
        label={t("enroll.manualLabel")}
        value={secret}
        isReadOnly
        // Not `autoComplete="off"`: this is not a completable field at all, and a
        // browser must never offer to remember it.
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
