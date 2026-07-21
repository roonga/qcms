import { ChallengeSlot } from "@/components/challenge-slot";
import { PortalShell } from "@/components/portal-shell";
import { t } from "@/lib/i18n/en";
import { buttonClass } from "@/lib/ui";

/**
 * Anonymous / secure-link entry (wireframe `/f/:formSlug`): a neutral invitation,
 * the optional pre-session challenge slot, and a Start button. The Start control
 * is a real form POST to the BFF start-session route, so it works with or without
 * JS. Nothing here evaluates or fetches the API directly (R2).
 */
export function EntryView({
  title,
  startAction,
}: {
  readonly title: string;
  readonly startAction: string;
}) {
  return (
    <PortalShell>
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold tracking-tight text-(--color-text)">{title}</h1>
        <p className="text-sm leading-relaxed text-(--color-text-muted)">{t("entry.startHint")}</p>
        <form action={startAction} method="post" className="flex flex-col gap-4">
          <ChallengeSlot />
          <button type="submit" className={buttonClass("primary")}>
            {t("action.start")}
          </button>
        </form>
      </div>
    </PortalShell>
  );
}
