import { isNonProd } from "@/lib/environment";
import { t } from "@/lib/i18n/en";

/**
 * The persistent banner, on every page while a non-prod environment is selected (ADR-40
 * Q6, task 065).
 *
 * ## Why a banner as well as a switcher
 *
 * The switcher is a control an operator looked at once; the banner is what is there when
 * they come back from lunch, open a second tab, or follow a link somebody sent them. Q6
 * names both for that reason, and the failure mode it is drawn against is concrete: an
 * erasure performed against the wrong environment is not undoable, and neither is a release
 * to `prod` that was meant for `test`.
 *
 * So it is **not dismissible**. Every other banner in this app can be put away
 * (`lib/builder-notice.ts`), because every other banner is about something that happened;
 * this one is about where the operator is, and a dismissed one would leave them in `test`
 * with nothing on screen saying so.
 *
 * ## Why it is absent under `prod`
 *
 * A banner on every screen all the time is a banner nobody reads, and production is the
 * state an operator has to be told about least - it is also the state every unprefixed
 * respondent address already means (Q21). So the banner's presence is itself information:
 * something on screen means this is **not** production.
 *
 * ## Never colour alone
 *
 * WCAG 1.4.1: the colour is one of three carriers. The banner names the environment in
 * words, it carries a persistent icon-free `role="status"` line an assistive technology
 * reads, and the switcher beside it shows the same name. An operator who cannot see the
 * colour still gets the fact from the sentence.
 *
 * A server component, rendered by the shell, so it is correct in the first byte of HTML
 * rather than after hydration: a banner that appears a moment late is a banner that was
 * absent while somebody pressed a button.
 *
 * `role="status"` rather than `role="alert"`: it is a persistent statement of where the
 * operator is, not an interruption. An alert would be announced again on every navigation,
 * which is the shape of a banner people learn to ignore.
 */
export function EnvironmentBanner({ environment }: { readonly environment: string }) {
  if (!isNonProd(environment)) return null;
  return (
    <div
      className="qcms-envbanner"
      data-testid="qcms-environment-banner"
      data-environment={environment}
      role="status"
    >
      <strong className="qcms-envbanner__name">{environment}</strong>
      <span>{t("environment.banner", { environment })}</span>
    </div>
  );
}
