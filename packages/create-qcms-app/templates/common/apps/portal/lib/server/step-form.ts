// The React-free subpath, so this server-only module never pulls the `@roonga/qcms-ui`
// client components into a Server Component.
import {
  assembleNativeDate,
  NATIVE_DATE_PART_PREFIX,
  NATIVE_FIELD_ANSWERED_PREFIX,
  NATIVE_FIELD_KIND_PREFIX,
  type DatePart,
  type NativeFieldKind,
} from "@roonga/qcms-ui/native-submit";
import {
  parseRosterOpValue,
  ROSTER_OP_FIELD,
  type RosterOpRequest,
} from "@roonga/qcms-ui/repeat-node";

import { SESSION_FIELD } from "../repeat";

export interface DecodedAnswer {
  readonly questionId: string;
  /**
   * The API validates this; the BFF never does. A literal `null` is a retraction rather
   * than a value, and it is unambiguous because it is not an `AnswerValue` in any
   * encoding (ADR-33).
   */
  readonly value: unknown;
}

export interface DecodedStepForm {
  readonly answers: readonly DecodedAnswer[];
  /**
   * At most one can arrive, so the first is taken: a forged second entry could only name
   * an operation the API would accept from the same respondent in their own session
   * anyway.
   */
  readonly rosterOp?: RosterOpRequest;
  /** A label rather than a credential: see {@link SESSION_FIELD}. */
  readonly sessionId?: string;
  readonly cleared: Readonly<Record<string, NativeFieldKind>>;
  /** The honeypot decoy, to forward to the submit body. */
  readonly extras: Readonly<Record<string, string>>;
  readonly fields: readonly string[];
}

const KINDS: ReadonlySet<string> = new Set<NativeFieldKind>([
  "string",
  "number",
  "radio",
  "multi",
  "date",
]);

const DATE_PARTS = Object.entries(NATIVE_DATE_PART_PREFIX) as readonly (readonly [
  DatePart,
  string,
])[];

/**
 * Coercion only, never a validity judgement. `undefined` means the field carried no
 * answer, which the caller reads as a clear or as silence depending on the marker.
 */
function decodeValue(
  kind: NativeFieldKind,
  raws: readonly string[],
  dateParts: Readonly<Partial<Record<DatePart, string>>> | undefined,
): unknown {
  switch (kind) {
    case "date":
      return assembleNativeDate(dateParts ?? {});
    case "multi": {
      const selected = raws.filter((v) => v !== "");
      return selected.length > 0 ? selected : undefined;
    }
    case "number": {
      const raw = raws[0];
      if (raw === undefined || raw.trim() === "") return undefined;
      // `Number("")` is 0, hence the blank guard above. A non-numeric string yields NaN,
      // which the API rejects as an encoding error; the BFF does not judge it.
      return Number(raw);
    }
    case "radio": {
      const raw = raws[0];
      if (raw === undefined || raw === "") return undefined;
      if (raw === "true") return true;
      if (raw === "false") return false;
      return raw;
    }
    case "string": {
      const raw = raws[0];
      return raw === undefined || raw === "" ? undefined : raw;
    }
  }
}

interface Partitioned {
  readonly rawByName: ReadonlyMap<string, string[]>;
  readonly kindByName: ReadonlyMap<string, NativeFieldKind>;
  readonly answered: ReadonlySet<string>;
  readonly datePartsByName: ReadonlyMap<string, Partial<Record<DatePart, string>>>;
  readonly rosterOp: RosterOpRequest | undefined;
  readonly sessionId: string | undefined;
}

function partition(entries: Iterable<[string, FormDataEntryValue]>): Partitioned {
  const rawByName = new Map<string, string[]>();
  const kindByName = new Map<string, NativeFieldKind>();
  const answered = new Set<string>();
  const datePartsByName = new Map<string, Partial<Record<DatePart, string>>>();
  let rosterOp: RosterOpRequest | undefined;
  let sessionId: string | undefined;
  // The reserved whole-name fields, taken before anything else so neither can land in
  // `extras` or be mistaken for an answer or for the honeypot.
  const takeReserved = (key: string, entry: string): boolean => {
    if (key === SESSION_FIELD) {
      sessionId ??= entry;
      return true;
    }
    if (key === ROSTER_OP_FIELD) {
      rosterOp ??= parseRosterOpValue(entry);
      return true;
    }
    return false;
  };
  /** The two reserved PREFIXES: a field's wire kind, and its answered marker. */
  const takePrefixed = (key: string, entry: string): boolean => {
    if (key.startsWith(NATIVE_FIELD_KIND_PREFIX)) {
      const name = key.slice(NATIVE_FIELD_KIND_PREFIX.length);
      if (KINDS.has(entry)) kindByName.set(name, entry as NativeFieldKind);
      return true;
    }
    if (key.startsWith(NATIVE_FIELD_ANSWERED_PREFIX)) {
      // Presence is the signal; the value is not read.
      answered.add(key.slice(NATIVE_FIELD_ANSWERED_PREFIX.length));
      return true;
    }
    for (const [part, prefix] of DATE_PARTS) {
      if (key.startsWith(prefix)) {
        const name = key.slice(prefix.length);
        const parts = datePartsByName.get(name) ?? {};
        parts[part] ??= entry;
        datePartsByName.set(name, parts);
        return true;
      }
    }
    return false;
  };
  for (const [key, entry] of entries) {
    if (typeof entry !== "string") continue;
    if (takeReserved(key, entry) || takePrefixed(key, entry)) continue;
    const list = rawByName.get(key);
    if (list === undefined) rawByName.set(key, [entry]);
    else list.push(entry);
  }
  return { rawByName, kindByName, answered, datePartsByName, rosterOp, sessionId };
}

/** File entries and unknown kind tags are ignored. */
export function decodeStepForm(entries: Iterable<[string, FormDataEntryValue]>): DecodedStepForm {
  const { rawByName, kindByName, answered, datePartsByName, rosterOp, sessionId } =
    partition(entries);
  const answers: DecodedAnswer[] = [];
  const cleared: Record<string, NativeFieldKind> = {};
  const fields = [...kindByName.keys()];

  for (const [name, kind] of kindByName) {
    const value = decodeValue(kind, rawByName.get(name) ?? [], datePartsByName.get(name));
    if (value !== undefined) {
      answers.push({ questionId: name, value });
    } else if (answered.has(name)) {
      // Marked as answered and arrived carrying nothing: the respondent cleared it.
      answers.push({ questionId: name, value: null });
      cleared[name] = kind;
    }
  }

  // Whatever is left with no kind tag is not an answer, so it is forwarded for the API's
  // anti-abuse check to see on the final submit.
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
