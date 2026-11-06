import { ImageResponse } from "next/og";

import { MASKABLE_BOX_FRACTION, pwaIconMark } from "@/lib/pwa/icon-mark";

export const dynamic = "force-static";

const SIZE = 512;

export function GET(): ImageResponse {
  return new ImageResponse(pwaIconMark(SIZE, MASKABLE_BOX_FRACTION), {
    width: SIZE,
    height: SIZE,
  });
}
