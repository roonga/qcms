import type { ReactElement } from "react";

import { PWA_GROUND_COLOR, PWA_MARK_COLOR } from "./brand";

/* The QCMS mark in the units of `app/icon.svg`, re-origined on its own bounding box: the magnifier
   alone, without the rounded plate, which every install surface draws for itself. */
const MARK_BOX = 17;
const RING_BORDER = 2.5;
const RING_OUTER = 15.5;
const HANDLE_LENGTH = 6.364;
const HANDLE_LEFT = 10.318;
const HANDLE_TOP = 12.25;

/** A maskable icon may be cropped to the central circle of 40% radius, which this box stays inside. */
export const MASKABLE_BOX_FRACTION = 0.54;

/** No crop applies, so the mark can sit closer to the edge than a maskable icon dares. */
export const APPLE_BOX_FRACTION = 0.62;

/** The mark on the Dark page ground, sized for `ImageResponse` at `size` square pixels. */
export function pwaIconMark(size: number, boxFraction: number): ReactElement {
  const unit = (size * boxFraction) / MARK_BOX;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: PWA_GROUND_COLOR,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          width: MARK_BOX * unit,
          height: MARK_BOX * unit,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            // Satori boxes are border-box, so these are the ring's outer bounds.
            width: RING_OUTER * unit,
            height: RING_OUTER * unit,
            border: `${String(RING_BORDER * unit)}px solid ${PWA_MARK_COLOR}`,
            borderRadius: (RING_OUTER * unit) / 2,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: HANDLE_LEFT * unit,
            top: HANDLE_TOP * unit,
            width: HANDLE_LENGTH * unit,
            height: RING_BORDER * unit,
            borderRadius: (RING_BORDER * unit) / 2,
            backgroundColor: PWA_MARK_COLOR,
            transform: "rotate(45deg)",
          }}
        />
      </div>
    </div>
  );
}
