// Import the transport constants from the React-free subpath, so this server-only
// BFF module never pulls the @roonga/qcms-ui client components into a Server Component.
import {
  NATIVE_FIELD_ANSWERED_PREFIX,
  NATIVE_FIELD_KIND_PREFIX,
  type NativeFieldKind,
} from "@roonga/qcms-ui/native-submit";

/**
 * Whole-step form decoding for the no-JS submit route (task 044).
 *
 * PURE transport mapping - NOT validation and NOT rule evaluation (R2). The
 * native-submit renderer (`@roonga/qcms-ui`) tags each answer field with its wire kind
 * (a `__qk__<questionId>` hidden input); this decoder turns the form-encoded
 * strings back into the canonical JSON shapes the internal API's answer endpoint
 * expects (a JSON boolean, a number, a string, an array), WITHOUT any knowledge
 * of the question definitions. The API remains the sole validation authority: it
 * re-validates every decoded value and rejects anything wrong (the BFF here never
 * decides whether a value is acceptable, visible, or required).
 *
 * A field with no kind tag is not an answer - it is the anti-abuse honeypot decoy
 * (026), returned verbatim in `extras` so the caller can forward it into the
 * session-submit body where the API's honeypot check reads it.
 *
 * ## Clearing an answer without JavaScript (issue #127)
 *
 * A native form cannot say "I emptied this". It posts an emptied text box exactly
 * as it posts a never-touched one (`name=""`), and posts an all-unchecked checkbox
 * group as nothing at all - the name simply does not appear. Under R2 this module
 * holds no answer state and may not ask the API what it holds, so it read both as
 * absence and dropped them. The scripted path had retracted an emptied control
 * since issue #98, so the same respondent gesture meant "cleared" with JavaScript
 * on and "no change" with it off, and a no-JS respondent who emptied a required
 * field submitted with the stale answer still standing.
 *
 * The renderer now emits a second hidden companion, `__qa__<questionId>`, for each
 * question that CURRENTLY HOLDS AN ANSWER (Code Owner ruling, 2026-09-02). That
 * turns the two indistinguishable posts into two different posts, and the rule
 * below is the whole of the change:
 *
 * | posted | marked answered | decoded |
 * | --- | --- | --- |
 * | a value | either | that value, as before |
 * | empty or absent | no | nothing, as before ("never answered") |
 * | empty or absent | yes | `null`, an ADR-33 retraction |
 *
 * This stays a pure decode of what arrived. The marker is a fact ABOUT THE POST,
 * carried by the form that produced it, not a prior state this module went and
 * looked up, so no answer-state authority and no rule evaluation move here. The
 * `null` it produces is the identical body the scripted path posts to the identical
 * endpoint, so both transports reach one ledger call.
 *
 * A forged marker retracts the forger's own answer inside their own session, which
 * the scripted path already permits by posting `null` directly; and a retraction of
 * a question holding no answer is a documented API no-op, so a marker on a
 * never-answered field appends nothing.
 *
 * **Number fields are out of scope**, and by construction rather than by exclusion.
 * A react-aria NumberField carries its form value in a hidden input that JavaScript
 * syncs, so with scripting off the respondent's edit never reaches the wire and the
 * seeded answer is what serializes: a marked number never arrives empty, so it can
 * never retract here, and equally cannot be cleared at all without JavaScript. That
 * gap is issue #18 (phase 4), not this seam.
 */

/** One decoded answer, ready to POST to the internal API's per-question endpoint. */
export interface DecodedAnswer {
  readonly questionId: string;
  /**
   * The canonical value; the API validates it (the BFF never does). A literal
   * `null` is a **retraction** rather than a value: the field was marked as holding
   * an answer and arrived empty, so the respondent cleared it (ADR-33, issue #127).
   * `null` is unambiguous here because it is not an `AnswerValue` in any encoding,
   * and it is what the API's answer endpoint already reads as a retraction.
   */
  readonly value: unknown;
}

/** The result of decoding a whole-step form POST. */
export interface DecodedStepForm {
  readonly answers: readonly DecodedAnswer[];
  /** Non-answer fields (the honeypot decoy) to forward to the submit body. */
  readonly extras: Readonly<Record<string, string>>;
}

const KINDS: ReadonlySet<string> = new Set<NativeFieldKind>(["string", "number", "radio", "multi"]);

/**
 * Decode one wire field (its raw string value(s)) to its canonical shape by kind.
 * Returns `undefined` for a field that carries no answer - absent, blank, or with
 * nothing selected - which the caller reads as a clear or as silence depending on
 * the answered marker. Coercion only - never a validity judgement.
 */
function decodeValue(kind: NativeFieldKind, raws: readonly string[]): unknown {
  switch (kind) {
    case "multi": {
      const selected = raws.filter((v) => v !== "");
      return selected.length > 0 ? selected : undefined;
    }
    case "number": {
      const raw = raws[0];
      if (raw === undefined || raw.trim() === "") return undefined;
      // Number("") is 0, hence the blank guard above; a non-numeric string yields
      // NaN, which the API rejects as an encoding error (the BFF does not judge).
      return Number(raw);
    }
    case "radio": {
      const raw = raws[0];
      if (raw === undefined || raw === "") return undefined;
      if (raw === "true") return true;
      if (raw === "false") return false;
      return raw; // a singleChoice OptionId
    }
    case "string": {
      const raw = raws[0];
      return raw === undefined || raw === "" ? undefined : raw;
    }
  }
}

/** The raw values (grouped by name), the kind tags, and the answered markers. */
interface Partitioned {
  readonly rawByName: ReadonlyMap<string, string[]>;
  readonly kindByName: ReadonlyMap<string, NativeFieldKind>;
  readonly answered: ReadonlySet<string>;
}

/** Split form entries into raw value groups, `__qk__` kinds and `__qa__` markers. */
function partition(entries: Iterable<[string, FormDataEntryValue]>): Partitioned {
  const rawByName = new Map<string, string[]>();
  const kindByName = new Map<string, NativeFieldKind>();
  const answered = new Set<string>();
  for (const [key, entry] of entries) {
    if (typeof entry !== "string") continue; // ignore any file parts
    if (key.startsWith(NATIVE_FIELD_KIND_PREFIX)) {
      const name = key.slice(NATIVE_FIELD_KIND_PREFIX.length);
      if (KINDS.has(entry)) kindByName.set(name, entry as NativeFieldKind);
      continue;
    }
    if (key.startsWith(NATIVE_FIELD_ANSWERED_PREFIX)) {
      // Presence is the signal; the value is not read (see the prefix's docblock).
      answered.add(key.slice(NATIVE_FIELD_ANSWERED_PREFIX.length));
      continue;
    }
    const list = rawByName.get(key);
    if (list === undefined) rawByName.set(key, [entry]);
    else list.push(entry);
  }
  return { rawByName, kindByName, answered };
}

/**
 * Partition a whole-step form POST into decoded answers and honeypot extras.
 * Accepts any iterable of `[name, value]` entries (a `FormData`); file entries
 * and unknown kind tags are ignored.
 */
export function decodeStepForm(entries: Iterable<[string, FormDataEntryValue]>): DecodedStepForm {
  const { rawByName, kindByName, answered } = partition(entries);
  const answers: DecodedAnswer[] = [];

  // Iterate the KIND TAGS, not the posted values. A control can be an answer field
  // and contribute no entry at all - an all-unchecked checkbox group posts nothing,
  // and that is precisely the clear that has to be seen - so the set of answer
  // fields is the set the renderer tagged, and the posted values are looked up
  // against it. Insertion order follows the tags' document order, which is the
  // fields' own order, so answers are forwarded in the order the form asked them.
  for (const [name, kind] of kindByName) {
    const value = decodeValue(kind, rawByName.get(name) ?? []);
    if (value !== undefined) {
      answers.push({ questionId: name, value });
    } else if (answered.has(name)) {
      // Marked as answered and arrived carrying nothing: the respondent cleared it.
      answers.push({ questionId: name, value: null });
    }
    // Otherwise: never answered, still not answered. Nothing to post.
  }

  // Whatever is left with no kind tag is not an answer: the honeypot decoy (or any
  // other non-answer field). Forward it so the API's anti-abuse check sees it on the
  // final submit (026). An `__qa__` marker naming a field with no kind tag is
  // neither an answer nor an extra: `partition` has already set it aside, and
  // nothing here can act on it.
  const extras: Record<string, string> = {};
  for (const [name, raws] of rawByName) {
    if (kindByName.has(name)) continue;
    extras[name] = raws[0] ?? "";
  }

  return { answers, extras };
}
