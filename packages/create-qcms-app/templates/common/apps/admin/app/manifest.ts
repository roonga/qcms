import type { MetadataRoute } from "next";

import { adminManifest } from "@/lib/pwa/manifest";

export default function manifest(): MetadataRoute.Manifest {
  return adminManifest();
}
