"use client";

import { useEffect } from "react";

import { HYDRATED_ATTRIBUTE } from "@/lib/hydration";

export function HydrationMarker(): null {
  useEffect(() => {
    document.documentElement.setAttribute(HYDRATED_ATTRIBUTE, "");
    return () => {
      document.documentElement.removeAttribute(HYDRATED_ATTRIBUTE);
    };
  }, []);
  return null;
}
