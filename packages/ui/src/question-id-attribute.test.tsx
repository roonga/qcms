import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import {
  instanceIdOfField,
  qualifiedFieldName,
  questionIdOfField,
} from "./repeat/repeat-node.ts";
import { loadGoldenForms } from "./test-support/golden.ts";

const ATTRIBUTE = "data-qcms-question-id";
const VENDORED = fileURLToPath(new URL("./components/a2ui", import.meta.url));

function goldenStep(version: string, form: string, stepId: string) {
  const golden = loadGoldenForms().find((entry) => entry.version === version && entry.form === form);
  if (golden === undefined) throw new Error(`no ${version} golden for ${form}`);
  const document = golden.compiled.documents.find((doc) => doc.stepId === stepId);
  if (document === undefined) throw new Error(`no step ${stepId} in ${form}`);
  return { document: document as A2UIStepDocument, spec: golden.compiled.a2uiSpecVersion };
}

function vendoredFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? vendoredFiles(path) : [path];
  });
}

describe("the question id on the field wrapper", () => {
  it("names each rendered question by its bare id", () => {
    const { document, spec } = goldenStep("v2", "kitchen-sink", "stp_about");
    const { container } = render(<A2UIStepRenderer document={document} specVersion={spec} />);
    const wrappers = Array.from(container.querySelectorAll<HTMLElement>("[data-qcms-field]"));
    expect(wrappers.length).toBeGreaterThan(0);
    for (const wrapper of wrappers) {
      expect(wrapper.getAttribute(ATTRIBUTE)).toBe(wrapper.dataset.qcmsField);
    }
  });

  it("drops the instance qualifier from a repeat member", () => {
    const { document, spec } = goldenStep("v4", "repeat-open-group", "stp_fleet");
    const roster = ["ins_a1", "ins_a2"];
    const { container } = render(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        repeat={{ rosters: { grp_vehicles: roster } }}
      />,
    );
    const member = container.querySelector<HTMLElement>(
      `[data-qcms-field="${qualifiedFieldName("ins_a2", "q_rep_plate")}"]`,
    );
    expect(member?.getAttribute(ATTRIBUTE)).toBe("q_rep_plate");
  });

  it("splits a field name into its question and instance", () => {
    expect(questionIdOfField("q_name")).toBe("q_name");
    expect(instanceIdOfField("q_name")).toBeUndefined();
    const qualified = qualifiedFieldName("ins_7k2", "q_plate");
    expect(questionIdOfField(qualified)).toBe("q_plate");
    expect(instanceIdOfField(qualified)).toBe("ins_7k2");
  });

  it("is never written into a vendored file", () => {
    const offenders = vendoredFiles(VENDORED).filter((path) =>
      readFileSync(path, "utf8").includes(ATTRIBUTE),
    );
    expect(offenders).toEqual([]);
  });
});
