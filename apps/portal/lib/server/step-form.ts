// Import the transport constants from the React-free subpath, so this server-only
// BFF module never pulls the @qcms/ui client components into a Server Component.
import { NATIVE_FIELD_KIND_PREFIX, type NativeFieldKind } from "@qcms/ui/native-submit";

/**
 * Whole-step form decoding for the no-JS submit route (task 044).
 *
 * PURE transport mapping - NOT validation and NOT rule evaluation (R2). The
 * native-submit renderer (`@qcms/ui`) tags each answer field with its wire kind
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
 */

/** One decoded answer, ready to POST to the internal API's per-question endpoint. */
export interface DecodedAnswer {
  readonly questionId: string;
  /** The canonical value; the API validates it (the BFF never does). */
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
 * Returns `undefined` for an unanswered field (absent / blank) so it is not
 * posted. Coercion only - never a validity judgement.
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

/** The raw values (grouped by name) and the kind tags, split out of the entries. */
interface Partitioned {
  readonly rawByName: ReadonlyMap<string, string[]>;
  readonly kindByName: ReadonlyMap<string, NativeFieldKind>;
}

/** Split form entries into raw value groups and their `__qk__` kind tags. */
function partition(entries: Iterable<[string, FormDataEntryValue]>): Partitioned {
  const rawByName = new Map<string, string[]>();
  const kindByName = new Map<string, NativeFieldKind>();
  for (const [key, entry] of entries) {
    if (typeof entry !== "string") continue; // ignore any file parts
    if (key.startsWith(NATIVE_FIELD_KIND_PREFIX)) {
      const name = key.slice(NATIVE_FIELD_KIND_PREFIX.length);
      if (KINDS.has(entry)) kindByName.set(name, entry as NativeFieldKind);
      continue;
    }
    const list = rawByName.get(key);
    if (list === undefined) rawByName.set(key, [entry]);
    else list.push(entry);
  }
  return { rawByName, kindByName };
}

/**
 * Partition a whole-step form POST into decoded answers and honeypot extras.
 * Accepts any iterable of `[name, value]` entries (a `FormData`); file entries
 * and unknown kind tags are ignored.
 */
export function decodeStepForm(entries: Iterable<[string, FormDataEntryValue]>): DecodedStepForm {
  const { rawByName, kindByName } = partition(entries);
  const answers: DecodedAnswer[] = [];
  const extras: Record<string, string> = {};
  for (const [name, raws] of rawByName) {
    const kind = kindByName.get(name);
    if (kind === undefined) {
      // No kind tag: the honeypot decoy (or any non-answer field). Forward it so
      // the API's anti-abuse check sees it on the final submit (026).
      extras[name] = raws[0] ?? "";
      continue;
    }
    const value = decodeValue(kind, raws);
    if (value !== undefined) answers.push({ questionId: name, value });
  }
  return { answers, extras };
}
