// Import the transport constants from the React-free subpath, so this server-only
// BFF module never pulls the @roonga/qcms-ui client components into a Server Component.
import {
  NATIVE_FIELD_ANSWERED_PREFIX,
  NATIVE_FIELD_KIND_PREFIX,
  type NativeFieldKind,
} from "@roonga/qcms-ui/native-submit";
import {
  parseRosterOpValue,
  ROSTER_OP_FIELD,
  type RosterOpRequest,
} from "@roonga/qcms-ui/repeat-node";

import { SESSION_FIELD } from "../repeat";

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
 * ## The roster operation, the fourth reserved name (task 073, ADR-43, Q9)
 *
 * `__qop` joins `__qk__`, `__qa__` and the honeypot's `website` as a name this
 * decoder reserves. It is how a respondent adds or removes an instance of a repeating
 * group **without scripting**: the Add and Remove controls are named **submit
 * buttons** on the step's own form, and a `<button name value>` contributes its name
 * and value to the form data set **only when it is the button that submitted the
 * form**. So a whole-step POST carries every field on the step plus **at most one**
 * `__qop` entry, or none, and no ordering rule and no repeated name is relied on
 * anywhere.
 *
 * The value is `add:grp_passengers:op_7f3` or
 * `remove:grp_passengers:ins_7k2:op_7f3`, and the last part is the **one-time
 * operation token** the rendered page minted. Decoding it here is still a pure
 * transport mapping: whether the group exists, whether the instance belongs to this
 * session and whether the token has been spent are all the API's to decide, against
 * the pinned snapshot and the roster rather than against a regular expression.
 *
 * **An `__qop` post commits NO answers** (Code Owner, 2026-09-30), and that is the
 * caller's rule rather than this module's: the answers are still decoded, because the
 * typed values have to be carried back into the re-render, and the caller is what
 * does not forward them to the ledger.
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
 * **Number fields reach this rule too, since issue #18.** They used to be out of
 * scope by construction: a react-aria NumberField carried its form value in a hidden
 * input that JavaScript syncs, so with scripting off the respondent's edit never
 * reached the wire and the seeded answer is what serialized - a marked number could
 * not arrive empty, so it could not retract, and could not be cleared at all. The
 * renderer now emits a real `<input type="number">` under the question's own name in
 * native mode (Code Owner ruling, 2026-09-19), so an emptied number arrives empty
 * beside its marker and decodes to the same `null` retraction as any other cleared
 * field. Nothing here changed to accommodate it, which is the point: the rule was
 * always about the post rather than about the control.
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
  /**
   * The roster operation this post carried, when it carried one (task 073, ADR-43).
   *
   * At most one, by construction rather than by a rule this decoder enforces: only
   * the pressed submit button contributes its name and value. A post carrying two
   * `__qop` entries is therefore not a shape a browser produces, and the first is
   * taken - a forged second entry can only name an operation the API would accept from
   * the same respondent anyway, in their own session, and it is refused or applied on
   * its own merits either way.
   */
  readonly rosterOp?: RosterOpRequest;
  /**
   * The session the form was rendered for, from the reserved `__qsid` hidden input.
   * A label rather than a credential: see {@link SESSION_FIELD}.
   */
  readonly sessionId?: string;
  /**
   * The fields the respondent CLEARED on this post, each with the wire kind the renderer
   * tagged it with. A subset of `answers`, where each appears with `value: null`.
   *
   * It exists because one caller has to RE-RENDER the post rather than forward it: the
   * `__qop` Server Action, which writes no answer and hands the step back. A field the
   * respondent emptied has to come back empty rather than showing the answer the API still
   * holds (`plan/repeating-groups-and-table-input.md` section 4.2), and what empty looks
   * like depends on the kind: an empty selection is `[]` and an empty anything-else is
   * `""`. The kind is the only thing that carries that distinction, and it does not belong
   * on `answers`, whose shape is the API's request body.
   */
  readonly cleared: Readonly<Record<string, NativeFieldKind>>;
  /** Non-answer fields (the honeypot decoy) to forward to the submit body. */
  readonly extras: Readonly<Record<string, string>>;
  /**
   * Every question the posted form ASKED, in document order - the kind-tagged
   * names, whether or not they carried a value (issue #920).
   *
   * `answers` cannot stand in for this: a question left blank contributes no
   * answer at all, and a blank required question is exactly the case the caller
   * has to report on. This is a fact about the post rather than about the flow -
   * "these are the fields that were on the page I submitted" - so reading it moves
   * no answer state and no rule evaluation into the BFF (R2). The caller uses it
   * only to narrow the API's own authoritative missing-required set to the step
   * the respondent was actually looking at.
   */
  readonly fields: readonly string[];
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

/** The raw values (grouped by name), the kind tags, the answered markers, the op. */
interface Partitioned {
  readonly rawByName: ReadonlyMap<string, string[]>;
  readonly kindByName: ReadonlyMap<string, NativeFieldKind>;
  readonly answered: ReadonlySet<string>;
  readonly rosterOp: RosterOpRequest | undefined;
  readonly sessionId: string | undefined;
}

/** Split form entries into raw value groups, `__qk__` kinds, `__qa__` markers, `__qop`. */
function partition(entries: Iterable<[string, FormDataEntryValue]>): Partitioned {
  const rawByName = new Map<string, string[]>();
  const kindByName = new Map<string, NativeFieldKind>();
  const answered = new Set<string>();
  let rosterOp: RosterOpRequest | undefined;
  let sessionId: string | undefined;
  for (const [key, entry] of entries) {
    if (typeof entry !== "string") continue; // ignore any file parts
    if (key === SESSION_FIELD) {
      // The form's own session (073). Reserved, so it is never read as an answer.
      sessionId ??= entry;
      continue;
    }
    if (key === ROSTER_OP_FIELD) {
      // The pressed Add or Remove button (073). Reserved, so it never lands in
      // `extras` and is never mistaken for an answer or for the honeypot.
      rosterOp ??= parseRosterOpValue(entry);
      continue;
    }
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
  return { rawByName, kindByName, answered, rosterOp, sessionId };
}

/**
 * Partition a whole-step form POST into decoded answers and honeypot extras.
 * Accepts any iterable of `[name, value]` entries (a `FormData`); file entries
 * and unknown kind tags are ignored.
 */
export function decodeStepForm(entries: Iterable<[string, FormDataEntryValue]>): DecodedStepForm {
  const { rawByName, kindByName, answered, rosterOp, sessionId } = partition(entries);
  const answers: DecodedAnswer[] = [];
  const cleared: Record<string, NativeFieldKind> = {};
  const fields = [...kindByName.keys()];

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
      cleared[name] = kind;
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

  return {
    answers,
    extras,
    fields,
    cleared,
    ...(rosterOp !== undefined ? { rosterOp } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
}
