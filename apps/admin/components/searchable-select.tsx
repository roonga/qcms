"use client";

import {
  ComboBox,
  ComboBoxButton,
  ComboBoxInput,
  ComboBoxLabel,
  ComboBoxListBox,
  ComboBoxOption,
  ComboBoxPopover,
} from "@/components/kit";
import { t } from "@/lib/i18n/en";

/** One choice, in the shape the kit's `Select` takes so the two are swappable. */
export interface SearchableItem {
  readonly label: string;
  readonly value: string;
}

/**
 * A picker you can type into (Code Owner, 2026-08-30).
 *
 * ## Why this exists beside the kit's `Select`
 *
 * A `Select` is a list you scan. That is right for a handful of choices and wrong the
 * moment the list is longer than the popover: the operator list is thirteen entries whose
 * names are phrases ("includes any of", "is at least"), and the question picker beside it
 * is every pinned question in the form, which the Code Owner has named several hundred as
 * the scale to design for. Both are lists you arrive at knowing roughly what you want,
 * which is the case a combobox is for.
 *
 * ## Why the APG pattern rather than a filter box bolted to a Select
 *
 * `react-aria-components`' `ComboBox` carries the input-to-listbox relationship, the
 * roving `aria-activedescendant`, the "N results available" announcement and the
 * type-to-filter behaviour. A text field above a `Select` looks the same and announces
 * nothing: a screen reader user would be typing into a box with no stated relationship to
 * the list it changes. `packages/ui/src/kit.ts` records why the primitives come from
 * react-aria-components rather than being vendored (ADR-22: the pinned registry has no
 * combobox).
 *
 * ## The two behaviours worth knowing
 *
 * **Selection is controlled and the text is not.** `selectedKey` is the caller's value;
 * the input's text is the component's own, so a half-typed filter is never a value. A
 * blur with no selection restores the selected item's label rather than leaving the box
 * showing something that was never chosen.
 *
 * **`disabledKeys` still means unavailable, not hidden.** The operator list disables the
 * operators a question's type does not accept rather than dropping them, which is the
 * behaviour the `Select` had and the reason an author can see that "is at least" exists
 * and is not available here. Filtering is about finding; disabling is about legality.
 */
export function SearchableSelect({
  label,
  value,
  items,
  disabledKeys,
  isDisabled = false,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly items: readonly SearchableItem[];
  readonly disabledKeys?: readonly string[];
  readonly isDisabled?: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <ComboBox
      className="qcms-combobox"
      // `value`/`onChange`, not `selectedKey`/`onSelectionChange`: react-stately deprecated
      // the second pair when the combobox grew a multiple-selection mode, and the lint
      // rule catches the deprecation rather than leaving it to a future major.
      value={value}
      // `defaultItems` rather than `items`: handing react-stately the collection as a
      // DEFAULT is what lets it own the filtering. Passing `items` declares the collection
      // fully controlled, and the caller then has to filter it by hand - which is the
      // version of this that gets the empty state and the announcement wrong.
      defaultItems={[...items]}
      // Spread unconditionally: `exactOptionalPropertyTypes` means passing `undefined` for
      // an optional prop is not the same as omitting it, and an empty list disables nothing.
      disabledKeys={[...(disabledKeys ?? [])]}
      isDisabled={isDisabled}
      // The list opens on focus, so the control behaves like the picker it replaces for
      // anyone who does not want to type at all.
      menuTrigger="focus"
      // WITHOUT THIS THE EMPTY STATE NEVER RENDERS. react-aria closes the popover when the
      // collection empties, so a filter that matches nothing just shuts the list - which is
      // indistinguishable from the control having failed, and is the exact thing
      // `renderEmptyState` below exists to prevent.
      allowsEmptyCollection
      onChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
    >
      <ComboBoxLabel className="qcms-combobox__label">{label}</ComboBoxLabel>
      <div className="qcms-combobox__control">
        <ComboBoxInput className="qcms-combobox__input" />
        <ComboBoxButton
          className="qcms-combobox__toggle"
          // The toggle has no text, and "open" alone would be five identical buttons on a
          // condition with five leaves. The field's own name is what tells them apart.
          aria-label={t("forms.combobox.toggle", { label })}
        >
          <span aria-hidden="true">{"▾"}</span>
        </ComboBoxButton>
      </div>
      <ComboBoxPopover className="qcms-combobox__popover">
        <ComboBoxListBox
          className="qcms-combobox__listbox"
          // The empty state is a sentence rather than an empty box: a filter that matches
          // nothing and a list that has nothing look identical without one.
          renderEmptyState={() => (
            <p className="qcms-combobox__empty">{t("forms.combobox.noMatch")}</p>
          )}
        >
          {(item: SearchableItem) => (
            <ComboBoxOption
              id={item.value}
              className="qcms-combobox__option"
              textValue={item.label}
            >
              {item.label}
            </ComboBoxOption>
          )}
        </ComboBoxListBox>
      </ComboBoxPopover>
    </ComboBox>
  );
}
