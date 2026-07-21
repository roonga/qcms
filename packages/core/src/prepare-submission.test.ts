import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  compileDraft,
  computeContentHash,
  LockedSubmission,
  parseFormDefinition,
  parseQuestionDefinition,
  prepareSubmission,
  type AnswerMap,
  type AnswerValue,
  type DraftInput,
  type FormDefinition,
  type FrozenSnapshot,
  type QuestionDefinition,
  type QuestionId,
  type QuestionVersionRecord,
  type SubmissionError,
} from "./index.js";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, ...segments), "utf8"));
}

function loadForm(file: string): FormDefinition {
  const result = parseFormDefinition(readJson("forms", "valid", file));
  if (!result.ok) {
    throw new Error(`fixture ${file} did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function makeQuestion(definition: unknown): QuestionDefinition {
  const result = parseQuestionDefinition(definition);
  if (!result.ok) {
    throw new Error(`test question did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Compile a form fixture against the task-003 question fixtures (published
 * at versions 1 and 2 - the forms pin q_at_fault_accident@2, everything else @1). */
function fixtureSnapshot(file: string): FrozenSnapshot {
  const records: QuestionVersionRecord[] = [];
  const published = new Map<QuestionId, Set<number>>();
  for (const entry of readdirSync(path.join(FIXTURES_DIR, "questions", "valid"))) {
    const definition = makeQuestion(readJson("questions", "valid", entry));
    for (const version of [1, 2]) {
      records.push({ questionId: definition.questionId, version, definition });
    }
    published.set(definition.questionId, new Set([1, 2]));
  }
  const byKey = new Map(records.map((r) => [`${r.questionId}@${String(r.version)}`, r]));
  const draft: DraftInput = {
    definition: loadForm(file),
    resolveQuestion: (questionId, version) => byKey.get(`${questionId}@${String(version)}`),
    publishedQuestionVersions: published,
  };
  const result = compileDraft(draft);
  if (!result.ok) {
    throw new Error(`fixture ${file} did not compile: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// Casts justified: test ids are known-valid `q_*`/`opt_*` literals matching
// the branded patterns; branding once here keeps call sites free of unwraps.
const asQuestionId = (id: string): QuestionId => id as QuestionId;

/** A multiChoice AnswerValue (OptionId[]) from option-id literals. */
const opts = (...ids: string[]): AnswerValue => ids as AnswerValue;

function answersOf(entries: readonly [string, AnswerValue][]): AnswerMap {
  return new Map(entries.map(([id, value]) => [asQuestionId(id), value]));
}

async function lockedOf(snapshot: FrozenSnapshot, answers: AnswerMap): Promise<LockedSubmission> {
  const result = await prepareSubmission(snapshot, answers);
  if (!result.ok) {
    throw new Error(`expected ok, got: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

async function errorsOf(
  snapshot: FrozenSnapshot,
  answers: AnswerMap,
): Promise<readonly SubmissionError[]> {
  const result = await prepareSubmission(snapshot, answers);
  if (result.ok) {
    throw new Error("expected err, got ok");
  }
  return result.error;
}

const insurance = () => fixtureSnapshot("insurance.json");

/** The questionId a submission error names (FLOW_EVALUATION_FAILED has none). */
const idOf = (error: SubmissionError): string | null =>
  "questionId" in error ? error.questionId : null;

describe("prepareSubmission - the I9 sweep on the insurance fixture", () => {
  it("locks a complete valid submission (canonical ordered answers)", async () => {
    const locked = await lockedOf(
      insurance(),
      answersOf([
        ["q_accident_count", 20], // reversed input order: output is document order
        ["q_at_fault_accident", true],
      ]),
    );
    expect(locked.answers).toEqual([
      { questionId: "q_at_fault_accident", value: true },
      { questionId: "q_accident_count", value: 20 },
    ]);
    expect(locked.flowState.complete).toBe(true);
    expect(locked.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // The output parses against its own schema (Zod as source of truth).
    expect(LockedSubmission.safeParse(locked).success).toBe(true);
  });

  it("visible required missing blocks with the correct id list", async () => {
    const empty = await errorsOf(insurance(), answersOf([]));
    expect(empty.map((error) => [error.code, idOf(error)])).toEqual([
      ["MISSING_REQUIRED", "q_at_fault_accident"],
    ]);

    // q_at_fault_accident=true reveals the required follow-up.
    const partial = await errorsOf(insurance(), answersOf([["q_at_fault_accident", true]]));
    expect(partial.map((error) => [error.code, idOf(error)])).toEqual([
      ["MISSING_REQUIRED", "q_accident_count"],
    ]);
  });

  it("a hidden required question does NOT block submit (I6 beats I9)", async () => {
    // q_accident_count is required in its pinned definition, but q_at_fault_accident=false
    // hides it - the sweep only covers *visible* required questions.
    const locked = await lockedOf(insurance(), answersOf([["q_at_fault_accident", false]]));
    expect(locked.answers).toEqual([{ questionId: "q_at_fault_accident", value: false }]);
    expect(locked.flowState.complete).toBe(true);
  });

  it("a hidden answered question is excluded from the locked set (I6)", async () => {
    // The DOMAIN_SCHEMA §6 stale-answer story: answered while visible, then
    // hidden by changing q_at_fault_accident. The orphaned answer stays in the input
    // (and the ledger) but never reaches the submission.
    const input = answersOf([
      ["q_at_fault_accident", false],
      ["q_accident_count", 20],
    ]);
    expect(input.has(asQuestionId("q_accident_count"))).toBe(true); // assertable in input
    const locked = await lockedOf(insurance(), input);
    expect(locked.answers.map((entry) => entry.questionId)).toEqual(["q_at_fault_accident"]);
    // A hidden answer also does not perturb the hash: same as never given.
    const withoutOrphan = await lockedOf(insurance(), answersOf([["q_at_fault_accident", false]]));
    expect(locked.contentHash).toBe(withoutOrphan.contentHash);
  });

  it("re-validates present visible answers → INVALID_ANSWER with the full constraint list", async () => {
    const errors = await errorsOf(
      insurance(),
      answersOf([
        ["q_at_fault_accident", true],
        ["q_accident_count", -1.5], // violates min 0 AND integer
      ]),
    );
    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error?.code).toBe("INVALID_ANSWER");
    if (error?.code !== "INVALID_ANSWER") {
      throw new Error("unreachable");
    }
    expect(error.questionId).toBe("q_accident_count");
    expect(error.errors.map((nested) => nested.code)).toEqual([
      "VALUE_BELOW_MIN",
      "NOT_AN_INTEGER",
    ]);
    // Never echo the answer value (SEC).
    expect(JSON.stringify(errors)).not.toContain("-1.5");
  });

  it("answers for questions not in the form → UNKNOWN_QUESTION (ledger-drift defense)", async () => {
    const errors = await errorsOf(
      insurance(),
      answersOf([
        ["q_at_fault_accident", true],
        ["q_accident_count", 20],
        ["q_zz_drifted", 1],
        ["q_aa_drifted", 2],
      ]),
    );
    // Unknown ids sorted (they have no document position).
    expect(errors.map((error) => [error.code, idOf(error)])).toEqual([
      ["UNKNOWN_QUESTION", "q_aa_drifted"],
      ["UNKNOWN_QUESTION", "q_zz_drifted"],
    ]);
  });

  it("reports are complete: every failure kind at once, never first-only", async () => {
    const errors = await errorsOf(
      insurance(),
      answersOf([
        ["q_at_fault_accident", true],
        ["q_accident_count", 0.5],
        ["q_drifted", 1],
      ]),
    );
    expect(errors.map((error) => error.code)).toEqual(["INVALID_ANSWER", "UNKNOWN_QUESTION"]);
  });

  it("FLOW_EVALUATION_FAILED (typed, never thrown) when the snapshot cannot evaluate", async () => {
    const good = insurance();
    const alien: FrozenSnapshot = {
      definition: good.definition,
      questions: good.questions,
      semanticsVersion: 999, // this evaluator does not implement 999
      schemaVersion: good.schemaVersion,
    };
    const errors = await errorsOf(alien, answersOf([["q_drifted", 1]]));
    expect(errors.map((error) => error.code)).toEqual([
      "FLOW_EVALUATION_FAILED",
      "UNKNOWN_QUESTION", // drift defense still reported alongside
    ]);
    const [failure] = errors;
    if (failure?.code !== "FLOW_EVALUATION_FAILED") {
      throw new Error("unreachable");
    }
    expect(failure.cause.code).toBe("UNSUPPORTED_SEMANTICS_VERSION");
  });
});

describe("prepareSubmission - kitchen-sink (all seven types lock canonically)", () => {
  it("locks a full submission in document order with canonical values", async () => {
    const locked = await lockedOf(
      fixtureSnapshot("kitchen-sink.json"),
      answersOf([
        ["q_coverage_level", "opt_standard"],
        ["q_medical_history", "Asthma since childhood"],
        ["q_preexisting_conditions", opts("opt_asthma", "opt_asthma")],
        ["q_accident_count", 5],
        ["q_at_fault_accident", true],
        ["q_dob", "1990-05-04"],
        ["q_full_name", "Ada Lovelace"],
      ]),
    );
    expect(locked.answers).toEqual([
      { questionId: "q_full_name", value: "Ada Lovelace" },
      { questionId: "q_dob", value: "1990-05-04" },
      { questionId: "q_at_fault_accident", value: true },
      { questionId: "q_accident_count", value: 5 },
      { questionId: "q_preexisting_conditions", value: ["opt_asthma"] }, // deduplicated
      { questionId: "q_medical_history", value: "Asthma since childhood" },
      { questionId: "q_coverage_level", value: "opt_standard" },
    ]);
    expect(locked.flowState.complete).toBe(true);
  });
});

describe("canonicalJson", () => {
  it("sorts object keys lexicographically at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order (order is meaning)", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("omits undefined object members and nulls undefined array slots", () => {
    expect(canonicalJson({ a: 1, gone: undefined })).toBe('{"a":1}');
    expect(canonicalJson([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("serializes primitives exactly as JSON.stringify", () => {
    expect(canonicalJson("text")).toBe('"text"');
    expect(canonicalJson(1.5)).toBe("1.5");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(null)).toBe("null");
  });
});

describe("contentHash - stability (exit criterion 3)", () => {
  it("computeContentHash of {} is the well-known SHA-256 of the two bytes '{}'", async () => {
    // A cross-implementation anchor: independently verifiable with any
    // sha256 tool. Guards both the canonicalization and the hex encoding.
    expect(await computeContentHash({})).toBe(
      "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
  });

  it("is independent of object key order in the hashed content", async () => {
    expect(await computeContentHash({ a: 1, b: [{ x: 1, y: 2 }] })).toBe(
      await computeContentHash({ b: [{ y: 2, x: 1 }], a: 1 }),
    );
  });

  it("is independent of answer-map insertion order", async () => {
    const snapshot = insurance();
    const forward = await lockedOf(
      snapshot,
      answersOf([
        ["q_at_fault_accident", true],
        ["q_accident_count", 20],
      ]),
    );
    const reversed = await lockedOf(
      snapshot,
      answersOf([
        ["q_accident_count", 20],
        ["q_at_fault_accident", true],
      ]),
    );
    expect(forward.contentHash).toBe(reversed.contentHash);
  });

  it("hashes canonical values: NFD and NFC input spellings collide", async () => {
    const snapshot = fixtureSnapshot("kitchen-sink.json");
    const base: readonly [string, AnswerValue][] = [
      ["q_dob", "1990-05-04"],
      ["q_at_fault_accident", false],
      ["q_preexisting_conditions", opts("opt_none")],
      ["q_coverage_level", "opt_basic"],
    ];
    const nfc = await lockedOf(
      snapshot,
      answersOf([...base, ["q_full_name", "Ada".normalize("NFC")]]),
    );
    const nfd = await lockedOf(
      snapshot,
      answersOf([...base, ["q_full_name", "Ada".normalize("NFD")]]),
    );
    expect(nfc.contentHash).toBe(nfd.contentHash);
  });

  it("matches the committed golden hash for the insurance fixture submission", async () => {
    const golden = readJson("submissions", "insurance-golden.json") as {
      answers: Record<string, AnswerValue>;
      contentHash: string;
    };
    const locked = await lockedOf(insurance(), answersOf(Object.entries(golden.answers)));
    // Committed once; a mismatch on any machine or Node version is a
    // canonicalization drift, which would corrupt the audit boundary.
    expect(locked.contentHash).toBe(golden.contentHash);
  });
});
