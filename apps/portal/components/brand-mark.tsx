"use client";

/**
 * The deployment's brand mark in the portal header (task 053, folding issue #25).
 *
 * This replaces the `<span>QCMS</span>` literal the header carried since 029: an
 * adopter had to edit source to rebrand, and a respondent opening a registration
 * link was shown the engine's name instead of the name of whoever sent them the
 * link. Both the text and the optional logo now come from config
 * (`QCMS_PORTAL_BRAND_NAME` / `QCMS_PORTAL_BRAND_LOGO`, resolved in
 * `lib/server/theme.ts` and published through the appearance context).
 *
 * The name is ALWAYS rendered as text, and a configured logo sits beside it rather
 * than replacing it. That is a deliberate constraint rather than a missing option:
 * a logo-only mark makes the header's accessible name depend on alt text an
 * operator supplies in an environment variable, and a blank or careless one leaves
 * a respondent with an unlabelled image where the organisation's name should be. So
 * the logo is decorative (`alt=""`) and the text carries the meaning, which is also
 * why no `QCMS_PORTAL_BRAND_LOGO_ALT` variable exists to get wrong.
 *
 * A plain `<img>`, not `next/image`: this is one small operator-supplied asset of
 * unknown dimensions, served from the deployment's own origin, and the optimizer
 * would add a transform step and a layout contract for no benefit. Height is capped
 * by CSS so an oversized file cannot break the header.
 */

import { useAppearance } from "@/components/appearance-context";

export function BrandMark() {
  const state = useAppearance();
  if (state === null) return null;
  return (
    <span className="qcms-brand" data-testid="brand-mark">
      {state.brandLogoSrc === undefined ? null : (
        <img className="qcms-brand__logo" src={state.brandLogoSrc} alt="" />
      )}
      <span className="qcms-brand__name">{state.brandName}</span>
    </span>
  );
}
