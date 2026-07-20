import { fileURLToPath } from "node:url";

import {
  compileDraft,
  parseFormDefinition,
  parseLocaleCode,
  parseQuestionVersionRecord,
  type FrozenSnapshot,
  type LocaleCode,
  type QuestionId,
  type QuestionVersionRecord,
} from "@qcms/core";
import { parseNode } from "@a2ra/core";
import { describe, expect, it } from "vitest";

import { compileForm, compileFormWith } from "./compile.js";
import type { StepResolver } from "./step-resolver.js";
import type { A2UINode } from "./types.js";

/**
 * Kitchen-sink fixture: one publishable form exercising every question type,
 * both `singleChoice` renderings (RadioGroup ≤ 7 options, Select > 7), help
 * text (→ `description`), required flags, and every constraint kind. Built
 * through the real publish path (`compileDraft`) so the snapshot the compiler
 * receives is a genuine, deep-frozen, invariant-checked snapshot (task 008).
 */
function buildKitchenSinkSnapshot(): FrozenSnapshot {
  const en = (value: string): { en: string } => ({ en: value });

  const rawQuestions = [
    {
      questionId: "q_full_name",
      version: 1,
      definition: {
        type: "shortText",
        questionId: "q_full_name",
        label: en("Full name"),
        help: en("As it appears on your ID."),
        required: true,
        constraints: { minLength: 2, maxLength: 100, pattern: "^[a-zA-Z ]+$" },
      },
    },
    {
      questionId: "q_bio",
      version: 1,
      definition: {
        type: "longText",
        questionId: "q_bio",
        label: en("Short bio"),
        required: false,
        constraints: { maxLength: 500 },
      },
    },
    {
      questionId: "q_age",
      version: 1,
      definition: {
        type: "number",
        questionId: "q_age",
        label: en("Age"),
        help: en("In whole years."),
        required: true,
        constraints: { min: 0, max: 120, integer: true },
      },
    },
    {
      questionId: "q_dob",
      version: 1,
      definition: {
        type: "date",
        questionId: "q_dob",
        label: en("Date of birth"),
        required: false,
        constraints: { min: "1900-01-01", max: "2025-12-31" },
      },
    },
    {
      questionId: "q_smoker",
      version: 1,
      definition: {
        type: "boolean",
        questionId: "q_smoker",
        label: en("Do you smoke?"),
        required: true,
      },
    },
    {
      questionId: "q_coverage",
      version: 1,
      definition: {
        type: "singleChoice",
        questionId: "q_coverage",
        label: en("Coverage level"),
        required: true,
        options: [
          { optionId: "opt_basic", label: en("Basic") },
          { optionId: "opt_standard", label: en("Standard") },
          { optionId: "opt_premium", label: en("Premium") },
        ],
      },
    },
    {
      questionId: "q_country",
      version: 1,
      definition: {
        type: "singleChoice",
        questionId: "q_country",
        label: en("Country of residence"),
        help: en("Where you currently live."),
        required: false,
        options: [
          { optionId: "opt_us", label: en("United States") },
          { optionId: "opt_ca", label: en("Canada") },
          { optionId: "opt_gb", label: en("United Kingdom") },
          { optionId: "opt_au", label: en("Australia") },
          { optionId: "opt_de", label: en("Germany") },
          { optionId: "opt_fr", label: en("France") },
          { optionId: "opt_jp", label: en("Japan") },
          { optionId: "opt_in", label: en("India") },
        ],
      },
    },
    {
      questionId: "q_conditions",
      version: 1,
      definition: {
        type: "multiChoice",
        questionId: "q_conditions",
        label: en("Pre-existing conditions"),
        help: en("Select all that apply."),
        required: false,
        options: [
          { optionId: "opt_diabetes", label: en("Diabetes") },
          { optionId: "opt_hypertension", label: en("Hypertension") },
          { optionId: "opt_asthma", label: en("Asthma") },
        ],
        constraints: { minSelected: 0, maxSelected: 2 },
      },
    },
  ];

  const records: QuestionVersionRecord[] = rawQuestions.map((raw) => {
    const parsed = parseQuestionVersionRecord(raw);
    if (!parsed.ok) {
      throw new Error(`fixture question invalid: ${JSON.stringify(parsed.error)}`);
    }
    return parsed.value;
  });

  const rawForm = {
    formId: "frm_kitchen_sink",
    defaultLocale: "en",
    title: en("Kitchen-sink questionnaire"),
    steps: [
      {
        stepId: "stp_about",
        title: en("About you"),
        items: [
          { questionId: "q_full_name", version: 1 },
          { questionId: "q_bio", version: 1 },
          { questionId: "q_age", version: 1 },
          { questionId: "q_dob", version: 1 },
        ],
      },
      {
        stepId: "stp_health",
        title: en("Health details"),
        items: [
          { questionId: "q_smoker", version: 1 },
          { questionId: "q_coverage", version: 1 },
          { questionId: "q_country", version: 1 },
          { questionId: "q_conditions", version: 1 },
        ],
      },
    ],
    rules: [],
  };

  const form = parseFormDefinition(rawForm);
  if (!form.ok) {
    throw new Error(`fixture form invalid: ${JSON.stringify(form.error)}`);
  }

  const byPin = new Map(records.map((r) => [`${r.questionId} ${String(r.version)}`, r]));
  const publishedQuestionVersions = new Map<QuestionId, ReadonlySet<number>>(
    records.map((r) => [r.questionId, new Set([r.version])]),
  );

  const result = compileDraft({
    definition: form.value,
    resolveQuestion: (questionId, version) => byPin.get(`${questionId} ${String(version)}`),
    publishedQuestionVersions,
  });
  if (!result.ok) {
    throw new Error(`fixture snapshot did not publish: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** The child nodes of a node, or [] for text/leaf nodes (narrows the union). */
function childNodes(node: A2UINode): readonly A2UINode[] {
  const children = node.children;
  return children !== undefined && typeof children !== "string" ? children : [];
}

/** Depth-first list of every node `type` in a document tree (containers included). */
function collectTypes(node: A2UINode, into: Set<string> = new Set()): Set<string> {
  into.add(node.type);
  for (const child of childNodes(node)) {
    collectTypes(child, into);
  }
  return into;
}

/** Depth-first list of every node in a tree. */
function walk(node: A2UINode, into: A2UINode[] = []): A2UINode[] {
  into.push(node);
  for (const child of childNodes(node)) {
    walk(child, into);
  }
  return into;
}

/**
 * Validate a node against `@a2ra/core`'s strict recursive parser (the A2UI
 * spec is its Zod schemas, ADR-22); throws a ZodError on any non-conforming
 * node or prop.
 *
 * `@a2ra/core@1.0.0-preview.7` ships `.d.ts` files whose internal imports carry
 * `.ts` extensions, so its exported symbols resolve to `error` under
 * type-aware lint (tsc hides this via `skipLibCheck`). `parseNode` is genuinely
 * `(input: unknown) => A2NodeInput`; the single scoped disable below is for that
 * upstream packaging defect only (relayed as a cross-repo issue).
 */
function assertValidA2uiNode(node: A2UINode): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- @a2ra/core d.ts type-resolution defect (see note above)
  parseNode(node);
}

function localeOf(value: string): LocaleCode {
  const parsed = parseLocaleCode(value);
  if (!parsed.ok) {
    throw new Error(`invalid test locale: ${value}`);
  }
  return parsed.value;
}

const snapshot = buildKitchenSinkSnapshot();

describe("compileForm (kitchen-sink)", () => {
  it("produces one document per step, keyed by stepId in form order", () => {
    const compiled = compileForm(snapshot, {});
    expect(compiled.documents.map((d) => d.stepId)).toEqual(["stp_about", "stp_health"]);
  });

  it("stamps the compiler and A2UI-spec versions (ADR-18)", () => {
    const compiled = compileForm(snapshot, {});
    expect(compiled.compilerVersion).toBe("0.0.0");
    expect(compiled.a2uiSpecVersion).toBe("1.0.0-preview.7");
  });

  it("emits every question type's component across the documents (exit criterion 1)", () => {
    const compiled = compileForm(snapshot, {});
    const types = new Set<string>();
    for (const doc of compiled.documents) {
      collectTypes(doc.root, types);
    }
    // Structure + one control per question type (both singleChoice renderings).
    for (const expected of [
      "Form",
      "Flex",
      "Text",
      "TextField", // shortText
      "TextArea", // longText
      "NumberField", // number
      "DatePicker", // date
      "RadioGroup", // boolean + singleChoice ≤ 7
      "Radio",
      "Select", // singleChoice > 7
      "CheckboxGroup", // multiChoice
      "Checkbox",
    ]) {
      expect(types).toContain(expected);
    }
  });

  it("maps each control to the component and props the mapping doc specifies", () => {
    const [about, health] = compileForm(snapshot, {}).documents;
    const nodes = [...walk(about!.root), ...walk(health!.root)];
    const byName = (name: string) =>
      nodes.find((n) => (n.props as { name?: string } | undefined)?.name === name);

    expect(byName("q_full_name")).toMatchObject({
      type: "TextField",
      props: { label: "Full name", description: "As it appears on your ID.", isRequired: true },
    });
    expect(byName("q_bio")).toMatchObject({ type: "TextArea", props: { maxLength: 500 } });
    expect(byName("q_age")).toMatchObject({
      type: "NumberField",
      props: { minValue: 0, maxValue: 120, step: 1, isRequired: true },
    });
    expect(byName("q_dob")).toMatchObject({
      type: "DatePicker",
      props: { granularity: "day", minValue: "1900-01-01", maxValue: "2025-12-31" },
    });
    expect(byName("q_smoker")).toMatchObject({ type: "RadioGroup" });
    expect(byName("q_coverage")).toMatchObject({ type: "RadioGroup" }); // ≤ 7 options
    expect(byName("q_country")).toMatchObject({ type: "Select" }); // > 7 options
    expect(byName("q_conditions")).toMatchObject({
      type: "CheckboxGroup",
      props: { orientation: "vertical" },
    });
  });

  it("renders boolean as a two-child yes/no RadioGroup with true/false values", () => {
    const health = compileForm(snapshot, {}).documents[1]!;
    const group = walk(health.root).find(
      (n) => (n.props as { name?: string } | undefined)?.name === "q_smoker",
    )!;
    expect(group.children).toEqual([
      { type: "Radio", props: { value: "true", label: "Yes" } },
      { type: "Radio", props: { value: "false", label: "No" } },
    ]);
  });

  it("carries option ids as radio/checkbox/select values", () => {
    const health = compileForm(snapshot, {}).documents[1]!;
    const coverage = walk(health.root).find(
      (n) => (n.props as { name?: string } | undefined)?.name === "q_coverage",
    )!;
    expect(childNodes(coverage).map((c) => c.props?.value)).toEqual([
      "opt_basic",
      "opt_standard",
      "opt_premium",
    ]);
    const country = walk(health.root).find(
      (n) => (n.props as { name?: string } | undefined)?.name === "q_country",
    )!;
    expect((country.props as { items: { value: string }[] }).items.map((i) => i.value)).toEqual([
      "opt_us",
      "opt_ca",
      "opt_gb",
      "opt_au",
      "opt_de",
      "opt_fr",
      "opt_jp",
      "opt_in",
    ]);
  });

  it("leaves every control's error slot (errorMessage) unset for the renderer (028)", () => {
    const compiled = compileForm(snapshot, {});
    for (const doc of compiled.documents) {
      for (const node of walk(doc.root)) {
        expect(
          (node.props as { errorMessage?: unknown } | undefined)?.errorMessage,
        ).toBeUndefined();
      }
    }
  });

  it("emits the form title as h1 only on the first step, step title as h2 on every step", () => {
    const [about, health] = compileForm(snapshot, {}).documents;
    const headings = (doc: typeof about) =>
      walk(doc!.root)
        .filter((n) => n.type === "Text")
        .map((n) => ({ as: (n.props as { as?: string }).as, text: n.children }));
    expect(headings(about)).toEqual([
      { as: "h1", text: "Kitchen-sink questionnaire" },
      { as: "h2", text: "About you" },
    ]);
    expect(headings(health)).toEqual([{ as: "h2", text: "Health details" }]);
  });

  it("is deterministic: two runs are deep-equal (exit criterion 2)", () => {
    expect(compileForm(snapshot, {})).toEqual(compileForm(snapshot, {}));
  });

  it("resolves through the default locale when options.locale has no explicit entry (R7)", () => {
    // Single-locale launch: an unknown active locale falls back to defaultLocale
    // via resolveText, so output is identical to the default-locale compile.
    const withLocale = compileForm(snapshot, { locale: localeOf("fr") });
    expect(withLocale.documents).toEqual(compileForm(snapshot, {}).documents);
  });

  it("validates every compiled document against the pinned @a2ra/core schemas (exit criterion 5)", () => {
    const compiled = compileForm(snapshot, {});
    // parseNode is @a2ra/core's strict recursive node parser (the A2UI spec is
    // its Zod schemas, ADR-22): it throws a ZodError on any node/prop the
    // registry does not accept. A clean pass over every document proves spec
    // conformance mechanically, not by eye.
    for (const doc of compiled.documents) {
      expect(() => {
        assertValidA2uiNode(doc.root);
      }).not.toThrow();
    }
  });

  it("matches the committed golden output (hand-reviewed; seeds task 012)", async () => {
    const compiled = compileForm(snapshot, {});
    await expect(`${JSON.stringify(compiled, null, 2)}\n`).toMatchFileSnapshot(
      fileURLToPath(new URL("../fixtures/kitchen-sink.a2ui.json", import.meta.url)),
    );
  });
});

describe("compileFormWith (step-resolver seam)", () => {
  it("routes every step through the injected resolver (proves the swap point)", () => {
    // A stub test double standing in for a Phase-4 adaptive resolver.
    const stub: StepResolver = {
      resolveStep: (step) => ({
        stepId: step.stepId,
        root: { type: "Text", props: { as: "h2" }, children: `stub:${step.stepId}` },
      }),
    };
    const compiled = compileFormWith(stub, snapshot, {});
    expect(compiled.documents).toEqual([
      {
        stepId: "stp_about",
        root: { type: "Text", props: { as: "h2" }, children: "stub:stp_about" },
      },
      {
        stepId: "stp_health",
        root: { type: "Text", props: { as: "h2" }, children: "stub:stp_health" },
      },
    ]);
    // Version stamps still come from the compiler, not the resolver.
    expect(compiled.compilerVersion).toBe("0.0.0");
  });
});
