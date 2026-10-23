"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button, Dialog, TextField } from "@/components/kit";
import { useAddStepRequests } from "@/lib/forms/add-step-request";
import { useBuilderRail } from "@/lib/forms/builder-bridge";
import { t } from "@/lib/i18n/en";

/**
 * Add step, in the rail's Actions part (`plan/admin-design-contracts.md` §7.0 ruling 2.5,
 * issue #1116).
 *
 * ## What moved, and what did not
 *
 * The control itself. It used to sit inside the step cluster, directly under the list, which
 * is where `plan/admin-shell-poc/admin-shell-poc.html` draws it; §7.0 gives the rail one
 * Actions part at its foot and names "Add step" as one of the four structural actions that
 * belong there. So the control is the same control - the same quiet outline, the same
 * full-track geometry, the same dialog - rendered one part lower, and the cluster above it
 * is steps and nothing else.
 *
 * Nothing about WHAT it does moved. On the builder it is a button that opens a dialog,
 * because there is a draft in the browser to add a step to. On the other seven form screens
 * it is an anchor to the builder carrying {@link ADD_STEP_HASH}, because off the builder it
 * navigates and there is no draft here to add anything to (`docs/admin-constraints.md`: an
 * anchor navigates, a button acts).
 *
 * ## One dialog, two ways in
 *
 * The form row's own menu is the second way in, and it is in `components/forms/rail-steps.
 * tsx` - a different component since the control moved out of the step cluster. It asks
 * through `lib/forms/add-step-request.ts`, which is the module those two client trees share,
 * and that file writes out why one dialog is the requirement rather than a convenience.
 */

/**
 * The fragment another form screen's Add step lands on.
 *
 * `new-step` rather than the obvious `add-step`, and the name is load-bearing:
 * `scripts/check-admin-theme.mjs` reads every source file in this app for literal colours,
 * and `#add` is three hex digits, so `"#add-step"` fails the gate as a hardcoded colour.
 * It is not one, but the check cannot tell, and the right response to a coarse gate is to
 * stay clear of it rather than to carve an exemption into it - the same call
 * `lib/forms/builder-bridge.ts` records for naming its selector `choose` rather than
 * `select`.
 */
export const ADD_STEP_HASH = "#new-step";

export function RailAddStep({ builderHref }: { readonly builderHref: string }) {
  const builder = useBuilderRail();
  const requests = useAddStepRequests();
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  // The request this component has already acted on. Without it, every re-render of a
  // builder that re-renders constantly as an author types would reopen the dialog.
  const seen = useRef(0);

  useEffect(() => {
    if (requests === seen.current) return;
    seen.current = requests;
    setNewTitle("");
    setAdding(true);
  }, [requests]);

  // ARRIVING FROM ANOTHER FORM SCREEN'S ADD STEP, which is an anchor to the builder
  // carrying the fragment above. Reading it here rather than plumbing a prop down from the
  // slot keeps the server out of it entirely: a fragment never reaches the server, so
  // nothing about this page's cacheability changes.
  //
  // Cleared once read, and that is not tidiness: left in place, a reload - or a press of
  // Back onto this URL - would reopen a dialog the reader had already dismissed, with no
  // way to be rid of it short of editing the address bar.
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
      {/* `ghost` rather than `secondary`, which is a naming trap rather than a preference:
          the kit's `secondary` is a SOLID slate fill with white text, so in a rail of quiet
          rows it read as the loudest thing on the screen and as the primary action of the
          whole builder, which it is not. `ghost` is the kit's outlined treatment - a border
          and ordinary text colour - which is what a secondary action looks like here. The
          dialog it opens keeps `primary` on its confirm, because inside that dialog adding
          the step IS the primary action. */}
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
      {/* A dialog rather than a field standing open in the rail (Code Owner, 2026-08-26):
          the field was on screen whether or not anyone was adding a step, which is a
          permanent empty text input inside a navigation control. It is the shape Rename
          already uses, for the reason given there - the rail track is 240px, and a field
          inside it is narrower than most step titles. */}
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
