import {
  REPEAT_PRESENTATIONS,
  type DraftGroup,
  type DraftPin,
  type DraftRepeatCount,
  type DraftRule,
  type DraftStep,
  type DraftStepItem,
} from "./types.ts";
import type { LocalizedText } from "../questions/types.ts";

/**
 * One reader for the draft bytes, wherever they arrive from (task 074).
 *
 * ## Why this module exists, which is a defect rather than a tidy-up
 *
 * Two places in this app turn an API payload into the builder's working `DraftForm`, and they
 * are the same read of the same bytes:
 *
 * - `lib/server/forms.ts`, for `GET /admin/forms/{id}`, which is what the builder opens on;
 * - `lib/forms/assist-diff.ts`, for an agent proposal's `proposedDraft` (task 041), which is
 *   both the diff an author approves and the draft the builder holds after Accept.
 *
 * They were two implementations, and both read a step's item list as "every entry carrying a
 * `questionId`". That was total while a step held nothing else. With the repeating group
 * (ADR-42) it silently DROPS a group, and the two consequences are different sizes of the same
 * mistake: on the detail read a group survived until the first reload and then the builder
 * opened on a step that had been emptied; on the accept path the diff omits the group and every
 * question inside it, and `acceptedDraft` takes `steps` wholesale, so accepting a proposal that
 * merely echoes back an existing group DELETES the author's group.
 *
 * Fixing one parser and leaving the other is how the same defect arrives a third time, so there
 * is one reader now and both callers use it. Neither caller keeps a second opinion about the
 * shape of a step.
 *
 * ## Tolerant on purpose, and loud where it cannot be
 *
 * A draft may be an open working document, a seed copied from the newest published version, the
 * empty one `POST /forms` writes, or a proposal a model produced, and every surface has to open
 * on all of them. So anything structurally unreadable is dropped rather than thrown: an author
 * who can see a half-read draft can fix it, and one looking at a stack trace cannot.
 *
 * The one place that stance is NOT enough is a group's count source, which is why
 * {@link readRepeatCount} refuses rather than inventing. See its own note.
 *
 * Nothing here decides whether a draft is legal. That is the kernel's answer and it arrives as
 * `issues` from `POST .../draft/validate` (R2).
 */

/** `unknown` to a keyed object, as a predicate rather than a cast. */
function isKeyedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The entries of an array that are objects; anything else contributes nothing. */
function objects(raw: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(raw) ? raw.filter(isKeyedObject) : [];
}

/**
 * A localized text map, keeping only the entries whose value is a string.
 *
 * Validated rather than cast, which is the stricter of the two readings this module replaced: a
 * `title` carrying a number would otherwise reach `textOf` and render as one.
 */
export function readLocalizedText(raw: unknown): LocalizedText {
  if (!isKeyedObject(raw)) return {};
  const text: Record<string, string> = {};
  for (const [locale, value] of Object.entries(raw)) {
    if (typeof value === "string") text[locale] = value;
  }
  return text;
}

/** Every string in an array, in order. */
function strings(raw: unknown): readonly string[] {
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** One pinned question, or nothing when the entry does not carry the R6 pair. */
function readPin(record: Record<string, unknown>): DraftPin | undefined {
  if (typeof record["questionId"] !== "string" || typeof record["version"] !== "number") {
    return undefined;
  }
  return { questionId: record["questionId"], version: record["version"] };
}

/**
 * A pin list, which is what a group's member list is: a group holds no group (Q13), so there is
 * no deeper nesting to read and an instance's address stays a pair rather than a path.
 */
function readPins(raw: unknown): readonly DraftPin[] {
  return objects(raw)
    .map(readPin)
    .filter((pin): pin is DraftPin => pin !== undefined);
}

/**
 * A group's count source, read as given, or `undefined` when it is not one of the three.
 *
 * **Nothing is invented for an unreadable count**, and that is the one place this module's
 * tolerance stops. Falling back to, say, `open` with a minimum of zero would look tolerant and
 * would be the worst outcome available: the panel would show the invented source, the next
 * autosave would store it, and an author's `fixed` count would be gone with no press to have
 * reported it. {@link readStepItems} drops the whole group instead, which leaves the step short -
 * so autosave pauses and says so, which is loud rather than silent.
 *
 * `max` is carried through only when it is a number, which is what keeps the required-field state
 * readable after a reload: the kernel makes it optional precisely so a half-filled draft can
 * round-trip, so an absent `max` has to arrive back absent rather than as a zero.
 */
export function readRepeatCount(raw: unknown): DraftRepeatCount | undefined {
  if (!isKeyedObject(raw)) return undefined;
  const max = typeof raw["max"] === "number" ? { max: raw["max"] } : {};
  if (raw["source"] === "fixed" && typeof raw["count"] === "number") {
    return { source: "fixed", count: raw["count"] };
  }
  if (typeof raw["min"] !== "number") return undefined;
  if (raw["source"] === "open") return { source: "open", min: raw["min"], ...max };
  if (raw["source"] === "fromAnswer" && typeof raw["questionId"] === "string") {
    return { source: "fromAnswer", questionId: raw["questionId"], min: raw["min"], ...max };
  }
  return undefined;
}

/** One repeating group, or `undefined` when its count source is not one this build can read. */
function readGroup(record: Record<string, unknown>): DraftGroup | undefined {
  const count = readRepeatCount(record["count"]);
  if (count === undefined) return undefined;
  const presentation = REPEAT_PRESENTATIONS.find(
    (candidate) => candidate === record["presentation"],
  );
  return {
    groupId: record["groupId"] as string,
    label: readLocalizedText(record["label"]),
    instanceLabel: readLocalizedText(record["instanceLabel"]),
    items: readPins(record["items"]),
    count,
    // The kernel's schema defaults it, so a draft stored before the field existed carries none.
    presentation: presentation ?? "stacked",
  };
}

/**
 * A step's item list: pinned questions and repeating groups, in document order (ADR-42).
 *
 * The union is discriminated by the disjoint required keys the kernel chose (`questionId` against
 * `groupId`), so this reads the same discriminator the schema does rather than a tag nobody
 * sends. An entry claiming `groupId` and nothing a group needs is dropped rather than falling
 * through to the pin reader, because a group that cannot be read is not a pin.
 */
export function readStepItems(raw: unknown): readonly DraftStepItem[] {
  const items: DraftStepItem[] = [];
  for (const record of objects(raw)) {
    if (typeof record["groupId"] === "string") {
      const group = readGroup(record);
      if (group !== undefined) items.push(group);
      continue;
    }
    const pin = readPin(record);
    if (pin !== undefined) items.push(pin);
  }
  return items;
}

/** The draft's steps. A step with no id of its own is dropped: nothing could target it. */
export function readDraftSteps(raw: unknown): readonly DraftStep[] {
  return objects(raw)
    .filter((entry) => typeof entry["stepId"] === "string")
    .map((entry) => ({
      stepId: entry["stepId"] as string,
      title: readLocalizedText(entry["title"]),
      items: readStepItems(entry["items"]),
    }));
}

/**
 * The draft's rules. `when` is carried through as the condition tree it is: the structured editor
 * and the JSON pane both render whatever shape arrives, including an operator this build has
 * never heard of, which `rule-sentence.ts` renders as an admission rather than dropping.
 */
export function readDraftRules(raw: unknown): readonly DraftRule[] {
  return objects(raw)
    .filter((entry) => typeof entry["ruleId"] === "string" && isKeyedObject(entry["when"]))
    .map((entry) => ({
      ruleId: entry["ruleId"] as string,
      when: entry["when"] as DraftRule["when"],
      show: strings(entry["show"]),
    }));
}
