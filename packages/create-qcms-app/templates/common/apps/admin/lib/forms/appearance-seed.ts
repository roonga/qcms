"use client";

import { useCallback, useState } from "react";

import type { Appearance } from "@roonga/qcms-core";

export interface SeededAppearance {
  /** What the preview renders: the stored look, or the one the drawer is holding over it. */
  readonly appearance: Appearance | null;
  /** The drawer's live edit, which the stored look no longer replaces. */
  readonly preview: (next: Appearance | null) => void;
  /** Called once a save has stored what the drawer was holding. */
  readonly settle: () => void;
}

/**
 * The preview follows the stored draft, so a turn's own appearance edit and its Undo reach the
 * open page with no reload. While the drawer is holding a look the draft has not got, a
 * derive's among them, the stored value is held back rather than overwriting it.
 */
export function useSeededAppearance(stored: Appearance | null): SeededAppearance {
  const [appearance, setAppearance] = useState<Appearance | null>(stored);
  const [seeded, setSeeded] = useState<Appearance | null>(stored);
  const [held, setHeld] = useState(false);

  if (seeded !== stored) {
    setSeeded(stored);
    if (!held) setAppearance(stored);
  }

  const preview = useCallback((next: Appearance | null) => {
    setHeld(true);
    setAppearance(next);
  }, []);

  const settle = useCallback(() => {
    setHeld(false);
  }, []);

  return { appearance, preview, settle };
}
