"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Button,
  Dialog,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MenuTriggerButton,
  TextField,
} from "@/components/kit";
import { useBuilderRail } from "@/lib/forms/builder-bridge";
import { stepAnchorId } from "@/lib/forms/issues";
import { issueCountLabel, type RailItem } from "@/lib/forms/subtree-rail";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";

/**
 * The form's steps, inside the rail, on the builder (Code Owner, 2026-08-25).
 *
 * ## Why this is not `steps-rail.tsx` moved
 *
 * The builder used to carry its own step list as a card in the content column, beside a
 * rail that had none: one screen with two step lists and no single place that owned them.
 * That card cannot simply be relocated. It is a panel - a border, a surface, `p-4` - headed
 * by an `<h2>`, and the rail renders BEFORE `<main>` in document order, so a heading here
 * would sit above the screen's own `<h1>` and be a `heading-order` violation on this screen
 * in all three modes. What the rail needs is rail rows, so this is rail rows.
 *
 * `plan/admin-shell-poc/admin-shell-poc.html` is the drawing: a step row carries its
 * ordinal, its title, its issue badge and a menu of Rename / Move up / Move down / Remove
 * step, with an add control under the list. §7's clause forbidding actions in a rail was
 * retired on 2026-08-25 for exactly this; the question detail rail's lifecycle block had
 * already overruled it in practice.
 *
 * ## Two states, and the first one is not a placeholder
 *
 * Before the builder hydrates - and for a reader with no JavaScript at all - this renders
 * the steps the SERVER resolved, as ordinary anchors to `#step-{id}`. That is a real, usable
 * list rather than a skeleton: the slot had already loaded those steps in order to render
 * them, the anchors land on the step they name, and `lib/forms/issues.ts` mints the same
 * fragment the validation panel's focus links use.
 *
 * Once the builder publishes (`lib/forms/builder-bridge.ts`), the rows become buttons that
 * select a step in place and the menus appear. The list does not move or reorder as it
 * upgrades: it is the same steps in the same order, gaining behaviour.
 */
/**
 * The fragment an Add step link carries to the builder, and the builder's cue to open the
 * dialog on arrival.
 *
 * A fragment rather than a query parameter because it is a request to the BROWSER about
 * what to do on arrival rather than a different resource: `/forms/{id}#new-step` and
 * `/forms/{id}` are the same page, and a query string would say they were not - it would
 * be cached separately, and it would sit in the URL bar afterwards. The rail's step links
 * already address this page by fragment for exactly that reason.
 *
 * `new-step` rather than the obvious `add-step`, and the name is load-bearing:
 * `scripts/check-admin-theme.mjs` reads every source file in this app for literal colours,
 * and `#add` is three hex digits, so `"#add-step"` fails the gate as a hardcoded colour.
 * It is not one, but the check cannot tell, and the right response to a coarse gate is to
 * stay clear of it rather than to carve an exemption into it - the same call
 * `lib/forms/builder-bridge.ts` records for naming its selector `choose` rather than
 * `select`.
 */
const ADD_STEP_HASH = "#new-step";

export function RailSteps({
  item,
  serverItems,
}: {
  readonly item: RailItem;
  readonly serverItems: readonly RailItem[];
}) {
  const builder = useBuilderRail();
  // ONE dialog, opened from two places (Code Owner, 2026-08-26): the control under the
  // list, and the form row's own menu at the top of it. The state lives here rather than
  // in either control because two dialogs would be two drafts of a step title, and the one
  // you had typed into would depend on which control you had reached for.
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const openAdd = () => {
    setNewTitle("");
    setAdding(true);
  };

  // The other half of `AddStepLink`: arriving from another form screen's Add step, which is
  // an anchor to this one carrying the fragment below. Reading it here rather than plumbing
  // a prop down from the slot keeps the server out of it entirely - a fragment never reaches
  // the server, so nothing about this page's cacheability changes.
  //
  // Cleared once read, and that is not tidiness: left in place, a reload - or a press of
  // Back onto this URL - would reopen a dialog the reader had already dismissed, with no way
  // to be rid of it short of editing the address bar.
  //
  // Before the early return below, because a hook cannot be called conditionally. It costs
  // nothing on the screens with no builder: the fragment is only ever on this one.
  useEffect(() => {
    if (window.location.hash !== ADD_STEP_HASH) return;
    setNewTitle("");
    setAdding(true);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);
  if (builder === undefined) {
    return (
      <>
        {/* The row the server rendered, restated rather than imported: this file is a
            client component and `form-subtree-rail.tsx` is not, so taking its `RailRow`
            would pull that module into the client bundle to reuse four lines of markup. */}
        <Link
          href={item.href}
          className="qcms-rail__link"
          data-rail-item={item.key}
          {...(item.isCurrent ? { "aria-current": "page" as const } : {})}
        >
          <span>{item.label}</span>
        </Link>
        <ServerSteps items={serverItems} />
        {/* THE ADD CONTROL IS ON ALL EIGHT FORM SCREENS (Code Owner, 2026-08-26), and off
            the builder it is an anchor rather than a button, because off the builder it
            NAVIGATES - there is no draft in this tree to add a step to
            (`docs/admin-constraints.md`: an anchor navigates, a button acts). It lands on
            the builder with the fragment below, and the builder opens the dialog. */}
        <AddStepLink href={`${item.href}${ADD_STEP_HASH}`} />
      </>
    );
  }

  return (
    <div className="qcms-rail-steps">
      {/* THE FORM'S OWN ROW IS THIS ROW, not a second one under it. It briefly was a
          second one, which put "Form details" directly beneath "Builder" with both marked
          current: two rows, one meaning, and no way to tell which was which. The row that
          leads to this screen from the other seven IS the row that selects the form's own
          details once you are here, so it carries `item.label` - renamed to "Form details",
          because that is the screen it opens.

          A button rather than a link, unlike the same row on the other seven screens: this
          route is already the one the reader is standing on, so choosing it changes what
          the column beside the rail shows rather than navigating anywhere
          (`docs/admin-constraints.md`, an anchor navigates and a button acts). */}
      <div className="qcms-rail-steps__row">
        <button
          type="button"
          className="qcms-rail__link qcms-rail-steps__form"
          data-rail-item={item.key}
          aria-current={builder.selection.kind === "form" ? "page" : undefined}
          onClick={builder.chooseForm}
        >
          {/* A span rather than a bare text node, so the label is a flex ITEM the row can
              clip. Bare, it is an anonymous flex item that `text-overflow` cannot reach. */}
          <span>{item.label}</span>
        </button>
        {/* THE FORM'S OWN MENU, so adding a step is reachable from the top of the list as
            well as the bottom (Code Owner, 2026-08-26). With enough steps the control under
            them scrolls out of the rail, and this one never moves.

            It does NOT replace the one below: Add step appends, so the control beside where
            the new step appears is the one that matches what pressing it does. This is the
            second way in, not the way in, and the menu is where the form's other row-level
            commands will go when there are some. */}
        <MenuTrigger>
          <MenuTriggerButton
            className="qcms-rail-steps__menu"
            aria-label={t("forms.rail.formMenu", { title: item.label })}
          >
            <span aria-hidden="true">{"⋮"}</span>
          </MenuTriggerButton>
          <MenuPopover className="qcms-menu">
            <MenuList
              className="qcms-menu__list"
              aria-label={t("forms.rail.formMenu", { title: item.label })}
              onAction={(key) => {
                if (key === "add") openAdd();
              }}
            >
              <MenuItem id="add" className="qcms-menu__item">
                {t("forms.steps.add")}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </MenuTrigger>
      </div>
      <ol className="qcms-rail__group" aria-label={t("forms.rail.steps")} data-rail-group="steps">
        {builder.draft.steps.map((step, index) => (
          <li key={step.stepId}>
            <StepRow
              stepId={step.stepId}
              title={textOf(step.title) === "" ? t("forms.steps.untitled") : textOf(step.title)}
              position={index + 1}
              total={builder.draft.steps.length}
              issueCount={builder.issueCounts.get(step.stepId) ?? 0}
              isSelected={
                builder.selection.kind === "step" && builder.selection.stepId === step.stepId
              }
              onSelect={() => {
                builder.choose(step.stepId);
              }}
              onRename={(title) => {
                builder.rename(step.stepId, title);
              }}
              onMove={(delta) => {
                builder.move(step.stepId, delta);
              }}
              onRemove={() => {
                builder.remove(step.stepId);
              }}
            />
          </li>
        ))}
      </ol>
      <AddStep onOpen={openAdd} />
      {/* AFTER the steps and their add control, not inside them: the rules are the form's,
          not a step's, and the `<ol>` above is announced as a list of steps. A sibling row
          here says "another thing this screen can show", which is what it is.

          On the builder only. The other seven form screens render `ServerSteps` and no row
          for this, because a rule is not a route and there is nothing to select over there;
          `RulesSection` lives in the builder's own tree. */}
      <button
        type="button"
        className="qcms-rail__link qcms-rail-steps__form"
        data-rail-item="rules"
        aria-current={builder.selection.kind === "rules" ? "page" : undefined}
        onClick={builder.chooseRules}
      >
        <span>{t("forms.rail.rules")}</span>
      </button>
      {adding && (
        <AddStepDialog
          title={newTitle}
          onTitle={setNewTitle}
          onCancel={() => {
            setAdding(false);
          }}
          onAdd={() => {
            builder.add(newTitle.trim());
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * The pre-hydration list, and the whole of it for a scriptless reader.
 *
 * Deliberately the same markup the other seven form screens' steps use, so the rail does
 * not change shape when the builder takes it over.
 */
function ServerSteps({ items }: { readonly items: readonly RailItem[] }) {
  if (items.length === 0) return null;
  return (
    <ol className="qcms-rail__group" aria-label={t("forms.rail.steps")} data-rail-group="steps">
      {items.map((item) => (
        // `id` on the row rather than on a hidden span inside the link: the row IS the
        // destination, and a span carrying the title inside a link that already reads the
        // title would say it twice. `tabIndex={-1}` for the reason the interactive row's
        // anchor has it - a destination, not a stop on the way past.
        <li
          key={item.key}
          {...(item.anchorId === undefined ? {} : { id: item.anchorId })}
          tabIndex={-1}
        >
          <Link
            href={item.href}
            className="qcms-rail__link"
            data-rail-item={item.key}
            {...(item.isCurrent ? { "aria-current": "page" as const } : {})}
          >
            {item.position !== undefined && (
              <span className="qcms-rail__position" aria-hidden="true">
                {t("forms.rail.stepPosition", { position: item.position })}
              </span>
            )}
            <span>{item.label}</span>
            {item.issueCount > 0 && (
              <span className="qcms-tag qcms-tag--draft" data-rail-issues={item.issueCount}>
                {issueCountLabel(item.issueCount)}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ol>
  );
}

/**
 * One interactive step row: a button that selects, and a menu that acts on it.
 *
 * A button rather than an anchor, and that is the rule rather than an exception to it
 * (`docs/admin-constraints.md`: an anchor navigates, a button acts). Selecting a step
 * changes what the editor beside the rail is showing on the screen the reader is already
 * standing on; there is nothing to open in a new tab.
 *
 * REORDER IS A MENU COMMAND, NEVER A DRAG, which is the call the step list has made since
 * task 033 and the reason is unchanged: a drag-only reorder is unusable by keyboard and by
 * anyone with a motor impairment, and a second "accessible alternative" path is a second
 * path to keep in sync. Move up and move down are ordinary menu items.
 */
function StepRow({
  stepId,
  title,
  position,
  total,
  issueCount,
  isSelected,
  onSelect,
  onRename,
  onMove,
  onRemove,
}: {
  readonly stepId: string;
  readonly title: string;
  readonly position: number;
  readonly total: number;
  readonly issueCount: number;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly onRename: (title: string) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);

  return (
    <div className="qcms-rail-steps__row">
      <button
        type="button"
        className="qcms-rail__link qcms-rail-steps__select"
        data-rail-step-select={title}
        aria-current={isSelected ? "page" : undefined}
        onClick={onSelect}
      >
        {/* The accessible name is the whole sentence, and the visible composite is hidden
            from the tree so it is not read twice. Same shape the retired in-page step list
            used, and deliberately the same STRING: `openStep` and `addStep` in
            `e2e/support/forms.ts` name a step row this way, and so does anyone who has
            learned the screen. Moving the list should not rename its rows. */}
        <span className="qcms-visually-hidden">{t("forms.steps.select", { title })}</span>
        <span className="qcms-rail__position" aria-hidden="true">
          {t("forms.rail.stepPosition", { position })}
        </span>
        <span aria-hidden="true">{title}</span>
        {issueCount > 0 && (
          <span className="qcms-tag qcms-tag--draft" data-rail-issues={issueCount}>
            {issueCountLabel(issueCount)}
          </span>
        )}
      </button>

      <MenuTrigger>
        <MenuTriggerButton
          className="qcms-rail-steps__menu"
          aria-label={t("forms.steps.menu", { title })}
        >
          <span aria-hidden="true">{"⋮"}</span>
        </MenuTriggerButton>
        <MenuPopover className="qcms-menu">
          <MenuList
            className="qcms-menu__list"
            aria-label={t("forms.steps.menu", { title })}
            // Greyed rather than silently inert. `moveStep` is a no-op out of range, so
            // leaving them enabled corrupts nothing - but a menu that offers a command it
            // will not perform tells an assistive technology the wrong thing about what is
            // available, and tells everyone else nothing about why the list did not move.
            // Same rule the retired in-page list applied at the same two positions.
            disabledKeys={disabledCommands(position, total)}
            onAction={(key) => {
              if (key === "rename") {
                setDraftTitle(title);
                setRenaming(true);
              } else if (key === "up") onMove(-1);
              else if (key === "down") onMove(1);
              else if (key === "remove") setRemoving(true);
            }}
          >
            <MenuItem id="rename" className="qcms-menu__item">
              {t("forms.steps.rename")}
            </MenuItem>
            <MenuItem id="up" className="qcms-menu__item">
              {t("forms.steps.moveUp")}
            </MenuItem>
            <MenuItem id="down" className="qcms-menu__item">
              {t("forms.steps.moveDown")}
            </MenuItem>
            <MenuItem id="remove" className="qcms-menu__item">
              {t("forms.steps.remove")}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </MenuTrigger>

      {/* THE FOCUS TARGET FOR A STEP-LEVEL ISSUE, and it has to live wherever the step
          list does. `lib/forms/issues.ts` mints this id for the validation panel's "jump
          to the offending step" links, and the rail's own step rows on the other seven
          screens point at `/forms/{formId}#step-{stepId}`, which is this. It moved here
          with the list; when the list was deleted from the page it went with it, and the
          links pointed at nothing until this was restored.

          Out of the tab order (`tabIndex={-1}`) because it is a destination rather than a
          stop: reachable when something sends focus to it, never by tabbing past it. */}
      <span id={stepAnchorId(stepId)} tabIndex={-1} className="qcms-visually-hidden">
        {title}
      </span>

      {/* Rename is a dialog rather than an inline field, because the row is 240px wide and
          an input inside it would be narrower than most step titles. Removing a step takes
          its pins with it and leaves any rule that named it dangling, so it stays behind
          the confirm the step list has always had (`components/forms/steps-rail.tsx`'s
          reasoning, kept when its markup was not). */}
      {renaming && (
        <Dialog
          isOpen
          title={t("forms.steps.rename")}
          onOpenChange={(isOpen: boolean) => {
            if (!isOpen) setRenaming(false);
          }}
        >
          <TextField
            label={t("forms.steps.renameLabel", { title })}
            value={draftTitle}
            onChange={setDraftTitle}
          />
          <Button
            variant="primary"
            size="md"
            onPress={() => {
              onRename(draftTitle);
              setRenaming(false);
            }}
          >
            {t("forms.steps.renameDone")}
          </Button>
        </Dialog>
      )}

      {/* Removing a step takes its pins with it and leaves any rule that named it
          dangling, so it asks first. That confirm is not new here: it is the one the step
          list has had since task 033, kept when its markup was not. */}
      {removing && (
        <Dialog
          isOpen
          role="alertdialog"
          title={t("forms.steps.confirmRemoveTitle", { title })}
          description={t("forms.steps.confirmRemoveBody")}
          onOpenChange={(isOpen: boolean) => {
            if (!isOpen) setRemoving(false);
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="md"
              onPress={() => {
                onRemove();
                setRemoving(false);
              }}
            >
              {t("forms.steps.confirmRemove")}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onPress={() => {
                setRemoving(false);
              }}
            >
              {t("forms.action.cancel")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/**
 * The add control, under the list, where the drawing puts it.
 *
 * A BUTTON THAT OPENS A DIALOG rather than a field standing open in the rail (Code Owner,
 * 2026-08-26). The field was on screen whether or not anyone was adding a step, which put a
 * permanent empty text input under a navigation list and cost the rail a label, a control
 * and their spacing on every screen of the builder. It is the same shape Rename already
 * uses, and for the same reason given there: the rail track is 240px, and a field inside it
 * is narrower than most step titles.
 */
function AddStep({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <div className="qcms-rail-steps__add">
      {/* `ghost` rather than `secondary`, which is a naming trap rather than a preference:
          the kit's `secondary` is a SOLID slate fill with white text, so in a rail of quiet
          rows it read as the loudest thing on the screen and as the primary action of the
          whole builder, which it is not. `ghost` is the kit's outlined treatment - a border
          and ordinary text colour - which is what a secondary action looks like here. The
          dialog it opens keeps `primary` on its confirm, because inside that dialog adding
          the step IS the primary action. */}
      <Button variant="ghost" size="sm" onPress={onOpen}>
        {t("forms.steps.add")}
      </Button>
    </div>
  );
}

/**
 * Naming the new step, in a dialog, wherever the request came from.
 *
 * One component and one instance because there are two ways to ask for it now - the control
 * under the list and the form row's menu above it - and two dialogs would be two drafts of
 * a title, with the one you had typed into depending on which control you had reached for.
 *
 * A dialog rather than a field standing open in the rail (Code Owner, 2026-08-26): the field
 * was on screen whether or not anyone was adding a step, which is a permanent empty text
 * input inside a navigation control. It is the shape Rename already uses, for the reason
 * given there - the rail track is 240px, and a field inside it is narrower than most step
 * titles.
 */
function AddStepDialog({
  title,
  onTitle,
  onCancel,
  onAdd,
}: {
  readonly title: string;
  readonly onTitle: (next: string) => void;
  readonly onCancel: () => void;
  readonly onAdd: () => void;
}) {
  return (
    <Dialog
      isOpen
      title={t("forms.steps.add")}
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) onCancel();
      }}
    >
      <TextField label={t("forms.steps.newTitle")} value={title} onChange={onTitle} />
      <Button variant="primary" size="md" isDisabled={title.trim() === ""} onPress={onAdd}>
        {t("forms.steps.addDone")}
      </Button>
    </Dialog>
  );
}

/**
 * The add control on the seven form screens that have no builder mounted.
 *
 * Wearing the same geometry and the same quiet outline as the button it stands in for, so
 * the rail does not change shape between screens, but it is an `<a>`: pressing it goes to
 * the builder, which is where a step can actually be added. The kit's `Button` renders a
 * `<button>` and takes no `className`, so this is the shared row treatment written out in
 * `app/globals.css` rather than a second kit variant.
 */
function AddStepLink({ href }: { readonly href: string }) {
  return (
    <div className="qcms-rail-steps__add">
      <Link href={href} className="qcms-rail-steps__add-link">
        {t("forms.steps.add")}
      </Link>
    </div>
  );
}

/** The commands that do not apply at this position, so the menu greys them out. */
function disabledCommands(position: number, total: number): string[] {
  const disabled: string[] = [];
  if (position === 1) disabled.push("up");
  if (position === total) disabled.push("down");
  return disabled;
}
