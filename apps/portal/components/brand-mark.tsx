"use client";

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
