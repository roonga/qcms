"use client";

import { type ReactElement, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { SERVICE_WORKER_PATH, SKIP_WAITING } from "@/lib/pwa/service-worker";

/**
 * Registers the update-only worker and offers a reload once a replacement is waiting. The worker
 * takes over on the operator's press, never on its own, so no screen reloads mid-edit.
 */
export function AppUpdate(): ReactElement | null {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    let live = true;
    const detach: (() => void)[] = [];

    // A null controller means this is the first install, which replaces nothing worth announcing.
    const offer = (worker: ServiceWorker | null): void => {
      if (live && worker !== null && container.controller !== null) setWaiting(worker);
    };

    container
      .register(SERVICE_WORKER_PATH, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (!live) return;
        offer(registration.waiting);
        const onUpdateFound = (): void => {
          const installing = registration.installing;
          if (installing === null) return;
          const onStateChange = (): void => {
            if (installing.state === "installed") offer(registration.waiting ?? installing);
          };
          installing.addEventListener("statechange", onStateChange);
          detach.push(() => {
            installing.removeEventListener("statechange", onStateChange);
          });
        };
        registration.addEventListener("updatefound", onUpdateFound);
        detach.push(() => {
          registration.removeEventListener("updatefound", onUpdateFound);
        });
      })
      .catch(() => {
        // A refused registration costs the update notice and nothing else: nothing here is cached.
      });

    return () => {
      live = false;
      for (const off of detach) off();
    };
  }, []);

  const reload = useCallback(() => {
    waiting?.postMessage(SKIP_WAITING);
    window.location.reload();
  }, [waiting]);

  if (waiting === null) return null;

  return (
    <div className="qcms-appupdate" role="status" data-testid="qcms-app-update">
      <span>{t("appUpdate.available")}</span>
      <Button variant="secondary" size="sm" onPress={reload}>
        {t("appUpdate.reload")}
      </Button>
    </div>
  );
}
