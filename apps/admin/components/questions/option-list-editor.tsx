"use client";

import { useRef, useState } from "react";

import { Button, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import {
  addOption,
  moveOption,
  relabelOption,
  removeOption,
  textOf,
} from "@/lib/questions/definition";
import { fieldErrorProps } from "@/lib/questions/errors";
import type { ChoiceOptionView, DefinitionIssue } from "@/lib/questions/types";

/**
 * The option list editor for the two choice types (task 032, exit criterion 2).
 *
 * ## The invariant this component is built around
 *
 * An `optionId` is minted once, by "add option", and is never touched again. Everything
 * else here is deliberately shaped so that no other outcome is expressible:
 *
 * - There is **no input bound to `optionId`**. The id is rendered as text, so relabelling
 *   physically cannot reach it.
 * - Reorder swaps whole option records (`moveOption`), not labels, so an id can never end
 *   up beside a different label.
 * - Remove filters; it never renumbers. The survivors keep the ids they were minted with.
 *
 * That matters far beyond tidiness: a rule condition addresses an answer by option id, so
 * an id that moved during a reorder would silently rewrite what every existing rule and
 * every stored answer means (R6). It is asserted in both the unit tests and the
 * Playwright walk because "we were careful" is not a guarantee.
 *
 * ## Reordering without drag, and where focus goes
 *
 * Up and down are buttons, not a drag handle, because a drag-only reorder is unusable by
 * keyboard and by anyone with a motor impairment (the wireframe's a11y note asks for
 * exactly this). Each row is keyed by its `optionId`, which is also what makes focus
 * survive a move for free: React relocates the existing DOM nodes rather than rebuilding
 * them, so the button an operator just pressed is still the focused element, now one row
 * along. Pressing "move down" three times moves one option three places, which is the
 * behaviour anyone would expect and the one that a naive index key silently breaks.
 */
export function OptionListEditor({
  options,
  onChange,
  issues,
  isFrozen,
}: {
  readonly options: readonly ChoiceOptionView[];
  readonly onChange: (options: readonly ChoiceOptionView[]) => void;
  readonly issues: ReadonlyMap<string, DefinitionIssue[]>;
  readonly isFrozen: boolean;
}) {
  const [newLabel, setNewLabel] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  function handleAdd(): void {
    onChange(addOption(options, newLabel));
    setNewLabel("");
  }

  /**
   * Remove a row and put focus somewhere deliberate.
   *
   * A removed row takes the focused element with it, and a browser then drops focus to
   * `<body>` - which strands a keyboard operator at the top of the document with no
   * announcement. Moving it to the neighbouring row's remove button (or the add field
   * when the list empties) keeps the operator where they were working.
   */
  function handleRemove(index: number): void {
    onChange(removeOption(options, index));
    const neighbour = Math.max(0, index - 1);
    queueMicrotask(() => {
      const target = listRef.current?.querySelectorAll<HTMLElement>("[data-option-remove] button")[
        neighbour
      ];
      target?.focus();
    });
  }

  return (
    <fieldset className="qcms-fieldset">
      <legend className="qcms-fieldset__legend">{t("questions.options.legend")}</legend>
      <p className="text-sm text-(--color-text-muted)">{t("questions.options.note")}</p>
      <ul ref={listRef} className="flex flex-col gap-3">
        {options.map((option, index) => (
          <li key={option.optionId} className="qcms-option-row">
            <span className="qcms-option-row__id" title={t("questions.options.idColumn")}>
              {option.optionId}
            </span>
            <div className="qcms-option-row__label">
              <TextField
                label={t("questions.options.label", { position: index + 1 })}
                value={textOf(option.label)}
                isDisabled={isFrozen}
                {...fieldErrorProps(issues, `options.${index}.label`)}
                onChange={(value) => {
                  onChange(relabelOption(options, index, value));
                }}
              />
            </div>
            <div className="flex items-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                isDisabled={isFrozen || index === 0}
                onPress={() => {
                  onChange(moveOption(options, index, -1));
                }}
              >
                <span aria-hidden="true">{"↑"}</span>
                <span className="qcms-visually-hidden">
                  {t("questions.options.moveUp", { position: index + 1 })}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                isDisabled={isFrozen || index === options.length - 1}
                onPress={() => {
                  onChange(moveOption(options, index, 1));
                }}
              >
                <span aria-hidden="true">{"↓"}</span>
                <span className="qcms-visually-hidden">
                  {t("questions.options.moveDown", { position: index + 1 })}
                </span>
              </Button>
              <span data-option-remove="">
                <Button
                  variant="ghost"
                  size="sm"
                  isDisabled={isFrozen || options.length <= 1}
                  onPress={() => {
                    handleRemove(index);
                  }}
                >
                  {t("questions.options.remove", { position: index + 1 })}
                </Button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {!isFrozen && (
        <div className="qcms-option-add">
          <TextField
            label={t("questions.options.newLabel")}
            value={newLabel}
            onChange={setNewLabel}
          />
          <Button variant="secondary" size="md" onPress={handleAdd}>
            {t("questions.options.add")}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
