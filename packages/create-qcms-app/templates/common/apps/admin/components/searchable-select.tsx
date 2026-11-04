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

export interface SearchableItem {
  readonly label: string;
  readonly value: string;
}

/* Keep selectedKey controlled while filter text stays local; a half-typed filter must not become a
   selected value. */
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
      value={value}
      defaultItems={[...items]}
      disabledKeys={[...(disabledKeys ?? [])]}
      isDisabled={isDisabled}
      menuTrigger="focus"
      // Allow an empty collection explicitly: react-aria otherwise closes the popover before its empty-state
      // message can render.
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
          aria-label={t("forms.combobox.toggle", { label })}
        >
          <span aria-hidden="true">{"▾"}</span>
        </ComboBoxButton>
      </div>
      <ComboBoxPopover className="qcms-combobox__popover">
        <ComboBoxListBox
          className="qcms-combobox__listbox"
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
