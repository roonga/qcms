"use client";

/**
 * The name is always text and a configured logo sits beside it rather than replacing
 * it: a logo-only mark would make the header's accessible name depend on alt text an
 * operator supplies in an environment variable. So the logo is decorative and no
 * alt-text variable exists to get wrong.
 *
 * A plain `<img>`, not `next/image`: one small operator-supplied asset of unknown
 * dimensions from the deployment's own origin, for which the optimizer would add a
 * transform step and a layout contract and no benefit.
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
