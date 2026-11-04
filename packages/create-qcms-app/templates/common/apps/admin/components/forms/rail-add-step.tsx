"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button, Dialog, TextField } from "@/components/kit";
import { resetAddStepRequests, useAddStepRequests } from "@/lib/forms/add-step-request";
import { useBuilderRail } from "@/lib/forms/builder-bridge";
import { t } from "@/lib/i18n/en";

export const ADD_STEP_HASH = "#new-step";

export function RailAddStep({ builderHref }: { readonly builderHref: string }) {
  const builder = useBuilderRail();
  const requests = useAddStepRequests();
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  // Consume each request once so ordinary builder rerenders cannot reopen the add-step dialog.
  const seen = useRef(0);

  useEffect(() => {
    if (requests === seen.current) return;
    seen.current = requests;
    setNewTitle("");
    setAdding(true);
  }, [requests]);

  // Reset the module request on unmount so returning to the route cannot reopen a stale dialog.
  useEffect(() => resetAddStepRequests, []);

  // Read the fragment in the browser; fragments never reach the server and must not affect page caching.
  useEffect(() => {
    if (window.location.hash !== ADD_STEP_HASH) return;
    setNewTitle("");
    setAdding(true);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  if (builder === undefined) {
    return (
      <Link href={`${builderHref}${ADD_STEP_HASH}`} className="qcms-rail__action-link">
        {t("forms.steps.add")}
      </Link>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => {
          setNewTitle("");
          setAdding(true);
        }}
      >
        {t("forms.steps.add")}
      </Button>
      {adding && (
        <Dialog
          isOpen
          title={t("forms.steps.add")}
          onOpenChange={(isOpen: boolean) => {
            if (!isOpen) setAdding(false);
          }}
        >
          <TextField label={t("forms.steps.newTitle")} value={newTitle} onChange={setNewTitle} />
          <Button
            variant="primary"
            size="md"
            isDisabled={newTitle.trim() === ""}
            onPress={() => {
              builder.add(newTitle.trim());
              setAdding(false);
            }}
          >
            {t("forms.steps.addDone")}
          </Button>
        </Dialog>
      )}
    </>
  );
}
