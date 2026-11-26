import { describe, expect, it } from "vitest";
import { z } from "zod";

import { APPEARANCE_COLOR_TOKENS, deriveAppearance } from "@roonga/qcms-core";

import { ACTION_KIND_NAMES, BUILDER_ACTION_KINDS, actionKind } from "./actions/registry.js";
import { ActionStepResultBody, BUILDER_FACTS, stepResultRefusal } from "./schema.js";
import { AGENT_BUILDER_TOOL_NAMES, AGENT_TOOL_NAMES, TOOLS } from "./tools/registry.js";

/**
 * X4 over what tasks 111, 112 and 117 added: every builder fact, tool and action kind walked for
 * a slot that could carry a respondent's words, or a website's, to the model. The registries
 * drive the walks, so one added later arrives uncovered and fails.
 */

const SENTINEL = "RESPONDENT-ONLY-SENTINEL-VALUE";

function lowerHex(palette: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(palette).map(([token, hex]) => [token, hex.toLowerCase()]),
  );
}

/** One accepted instance per fact, which the sentinel walk then attacks slot by slot. */
function factSamples(): Readonly<Record<string, unknown>> {
  const derived = deriveAppearance({ primary: "#1d4ed8" });
  const palettes = derived.palettes as unknown as Record<string, Record<string, string>>;
  return {
    "fact preview-selection": {
      fact: "preview-selection",
      formId: "frm_contact",
      stepId: "stp_one",
      questionId: "q_first_name",
      device: "phone",
      viewport: { width: 390, height: 844 },
    },
    "fact layout-report": {
      fact: "layout-report",
      formId: "frm_contact",
      stepId: "stp_one",
      device: "tablet",
      viewport: { width: 768, height: 1024 },
      orientation: "portrait",
      zoomPercent: 100,
      colorScheme: "dark",
      highContrast: false,
      pageHeight: 1800,
      findings: [{ questionId: "q_first_name", issue: "truncated-label" }],
    },
    "fact derived-theme": {
      fact: "derived-theme",
      formId: "frm_contact",
      palettes: {
        light: lowerHex(palettes["light"] ?? {}),
        dark: lowerHex(palettes["dark"] ?? {}),
        lightHighContrast: lowerHex(palettes["lightHighContrast"] ?? {}),
        darkHighContrast: lowerHex(palettes["darkHighContrast"] ?? {}),
      },
      face: derived.face,
      pageTint: derived.pageTint,
      hasLogo: true,
      corrections: [
        {
          palette: "light",
          role: APPEARANCE_COLOR_TOKENS[0],
          from: "#1d4ed8",
          to: "#1b45c0",
        },
      ],
      tintDropped: ["darkHighContrast"],
    },
  };
}

/** Every path in an accepted instance that holds a string, which is every slot words could ride. */
function stringPaths(value: unknown, at: readonly string[] = []): readonly string[][] {
  if (typeof value === "string") return [[...at]];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => stringPaths(item, [...at, String(index)]));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => stringPaths(item, [...at, key]));
  }
  return [];
}

function withValue(value: unknown, path: readonly string[], replacement: string): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return replacement;
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      String(index) === head ? withValue(item, rest, replacement) : item,
    );
  }
  const record = value as Record<string, unknown>;
  return { ...record, [head]: withValue(record[head], rest, replacement) };
}

function jsonSchemaOf(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { io: "output", unrepresentable: "any" });
}

/** A string slot the schema leaves open: no enum, pattern, format or length to hold it. */
function freeStringPaths(node: unknown, at = "", found: string[] = []): readonly string[] {
  if (Array.isArray(node)) {
    node.forEach((item, index) => freeStringPaths(item, `${at}[${String(index)}]`, found));
    return found;
  }
  if (node === null || typeof node !== "object") return found;
  const record = node as Record<string, unknown>;
  if (record["type"] === "string") {
    const bounded = ["enum", "const", "pattern", "format", "maxLength"].some((key) =>
      Object.hasOwn(record, key),
    );
    if (!bounded) found.push(at);
  }
  for (const [key, value] of Object.entries(record)) {
    const step = key === "properties" || key === "$defs" ? at : `${at}.${key}`;
    if (key === "properties" && value !== null && typeof value === "object") {
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        freeStringPaths(child, `${at}.${name}`, found);
      }
      continue;
    }
    freeStringPaths(value, step, found);
  }
  return found;
}

describe("the sentinel walk over every builder fact", () => {
  const samples = factSamples();

  it("holds an accepted instance of every fact the registry lists", () => {
    expect(Object.keys(samples).sort()).toEqual(BUILDER_FACTS.map((fact) => fact.name).sort());
    for (const { name, schema } of BUILDER_FACTS) {
      expect(schema.safeParse(samples[name]).success, name).toBe(true);
    }
  });

  it("refuses the sentinel in every string slot of every fact", () => {
    for (const { name, schema } of BUILDER_FACTS) {
      const sample = samples[name];
      const paths = stringPaths(sample);
      // Not vacuous: a fact whose strings all vanished would otherwise pass this.
      expect(paths.length, name).toBeGreaterThan(1);
      for (const path of paths) {
        const attacked = withValue(sample, path, SENTINEL);
        expect(schema.safeParse(attacked).success, `${name} at ${path.join(".")}`).toBe(false);
      }
    }
  });

  it("refuses a long passage in every string slot of every fact", () => {
    const passage = "the page said ".repeat(40);
    for (const { name, schema } of BUILDER_FACTS) {
      const sample = samples[name];
      for (const path of stringPaths(sample)) {
        const attacked = withValue(sample, path, passage);
        expect(schema.safeParse(attacked).success, `${name} at ${path.join(".")}`).toBe(false);
      }
    }
  });
});

describe("the builder tools the model may call", () => {
  it("are all in the one registry the door reads", () => {
    for (const name of AGENT_BUILDER_TOOL_NAMES) {
      expect(AGENT_TOOL_NAMES, name).toContain(name);
      expect(TOOLS[name], name).toBeDefined();
    }
  });

  /**
   * The server writes a refusal sentence; nothing else a builder tool answers is free text.
   * A new open string slot fails here until it is named and justified.
   */
  const SERVER_WRITTEN: readonly string[] = [
    "output edit_question.reason",
    "output edit_step.reason",
    "output edit_rule.reason",
    "output edit_copy.reason",
    "output edit_appearance.reason",
  ];

  it("answer no free string the server did not write itself", () => {
    const open = AGENT_BUILDER_TOOL_NAMES.flatMap((name) =>
      freeStringPaths(jsonSchemaOf(TOOLS[name].outputSchema)).map(
        (path) => `output ${name}${path}`,
      ),
    );
    expect(open.sort()).toEqual([...SERVER_WRITTEN].sort());
  });
});

describe("the builder action kinds", () => {
  it("are all registered, so every vocabulary and card walk covers them", () => {
    for (const kind of BUILDER_ACTION_KINDS) {
      expect(ACTION_KIND_NAMES, kind).toContain(kind);
      expect(actionKind(kind), kind).toBeDefined();
    }
  });

  it("report no field outside their own list, whatever a client sends back", () => {
    const everyField = [
      ...new Set(ACTION_KIND_NAMES.flatMap((name) => actionKind(name)?.resultAllowlist ?? [])),
    ];
    for (const kind of BUILDER_ACTION_KINDS) {
      const allowed = actionKind(kind)?.resultAllowlist ?? [];
      const foreign = everyField.filter((field) => !allowed.includes(field));
      expect(foreign.length, kind).toBeGreaterThan(0);
      for (const field of foreign) {
        expect(
          stepResultRefusal({ kind, outcome: "done", result: { [field]: SENTINEL } }),
          field,
        ).toContain(field);
      }
    }
  });

  it("cap every reported value, so no passage rides back on one", () => {
    const passage = "x".repeat(201);
    for (const kind of BUILDER_ACTION_KINDS) {
      for (const field of actionKind(kind)?.resultAllowlist ?? []) {
        const parsed = ActionStepResultBody.safeParse({
          kind,
          outcome: "done",
          result: { [field]: passage },
        });
        expect(parsed.success, `${kind}.${field}`).toBe(false);
      }
    }
  });

  it("hold no publish, release, link or webhook kind", () => {
    for (const kind of BUILDER_ACTION_KINDS) {
      expect(kind.startsWith("form.publish"), kind).toBe(false);
      expect(kind.startsWith("form.release"), kind).toBe(false);
      expect(kind.startsWith("link."), kind).toBe(false);
      expect(kind.startsWith("webhook."), kind).toBe(false);
    }
  });
});
