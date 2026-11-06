import { ImageResponse } from "next/og";

import { MASKABLE_BOX_FRACTION, pwaIconMark } from "@/lib/pwa/icon-mark";

/* A fixed path, not a generated icon URL: the manifest has to name it, and Next fingerprints the
   URLs of the `icon` convention. */
export const dynamic = "force-static";

const SIZE = 192;

export function GET(): ImageResponse {
  return new ImageResponse(pwaIconMark(SIZE, MASKABLE_BOX_FRACTION), {
    width: SIZE,
    height: SIZE,
  });
}
