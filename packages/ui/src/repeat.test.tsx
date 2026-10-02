import {
  ANSWER_KEY_SEPARATOR,
  answerKey,
  type InstanceId,
  type QuestionId,
} from "@roonga/qcms-core";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { withDemotedHeadings } from "./heading-demotion.ts";
import {
  addButtonId,
  expandRepeatGroups,
  hasRepeatGroup,
  instanceLabelFor,
  parseRosterOpValue,
  qualifiedFieldName,
  removeLabelFor,
  ROSTER_OP_FIELD,
  rosterOpValue,
} from "./repeat/index.ts";
import { axeViolations } from "./test-support/a11y.ts";
import { loadGoldenForms } from "./test-support/golden.ts";
import { documentForVisible } from "./visible.ts";

/**
 * The repeating group in the renderer (task 073, ADR-42, ADR-43).
 *
 * This is the layer the two hardest halves of the task meet at: the compiler's
 * `RepeatGroup` **template** is expanded here, per live instance, and the `__qop`
 * buttons the no-JS roster operation rides on are rendered here. Every document
 * driven below comes from the golden corpus rather than being hand-written, so the
 * shapes asserted are the shapes the compiler actually emits (`golden/v4/`).
 *
 * Acceptance cases proved or part-proved here: 34 (one honeypot on a ten-instance
 * step, the DOM half), 37 (one input per row, the structural half), 38 (`longText`
 * and `multiChoice` inside a group), and the decoder-independent half of 30 (a form
 * carries at most one `__qop` entry, because only the pressed button contributes).
 */

const OPEN_GROUP = "repeat-open-group";
const COUNT_SOURCES = "repeat-count-sources";

function goldenStep(form: string, stepId: string): { document: A2UIStepDocument; spec: string } {
  const golden = loadGoldenForms().find((entry) => entry.version === "v4" && entry.form === form);
  if (golden === undefined) throw new Error(`no v4 golden for ${form}`);
  const document = golden.compiled.documents.find((doc) => doc.stepId === stepId);
  if (document === undefined) throw new Error(`no step ${stepId} in ${form}`);
  return { document, spec: golden.compiled.a2uiSpecVersion };
}

/** Instance ids shaped exactly like the API's (`packages/core/src/ids.ts`). */
function instances(count: number, prefix = "a"): string[] {
  return Array.from({ length: count }, (_unused, index) => `ins_${prefix}${String(index + 1)}`);
}

function names(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-qcms-field]")).map(
    (element) => element.dataset.qcmsField ?? "",
  );
}

describe("the qualified field name", () => {
  it("is the kernel's answer key, separator and all", () => {
    // The renderer does not depend on `@roonga/qcms-core` (the import-surface test keeps it
    // that way), so `INSTANCE_NAME_SEPARATOR` is spelled twice. This is the assertion
    // that keeps the two spellings one contract.
    expect(qualifiedFieldName("ins_7k2", "q_passport")).toBe(
      answerKey("q_passport" as QuestionId, "ins_7k2" as InstanceId),
    );
    expect(qualifiedFieldName("ins_7k2", "q_passport")).toBe(
      `ins_7k2${ANSWER_KEY_SEPARATOR}q_passport`,
    );
  });

  it("renumbers an instance label from the live ordinal and never from the id", () => {
    expect(instanceLabelFor("Vehicle {n}", 3)).toBe("Vehicle 3");
    // A template with no placeholder is legal (a group of one) and resolves to itself.
    expect(instanceLabelFor("The vehicle", 2)).toBe("The vehicle");
    expect(removeLabelFor("Remove {label}", "Vehicle 3")).toBe("Remove Vehicle 3");
  });

  it("does not expand a dollar sequence in a replacement", () => {
    // `String.replace` expands `$&` and `$1` inside a replacement STRING, and an
    // ordinal is a digit; both substitutions therefore use a function.
    expect(instanceLabelFor("$& {n} $1", 2)).toBe("$& 2 $1");
    expect(removeLabelFor("Remove {label}", "$& Vehicle")).toBe("Remove $& Vehicle");
  });
});

describe("the __qop wire vocabulary", () => {
  it("round-trips an add and a remove", () => {
    const add = { op: "add" as const, groupId: "grp_vehicles", token: "op_7f3" };
    expect(rosterOpValue(add)).toBe("add:grp_vehicles:op_7f3");
    expect(parseRosterOpValue(rosterOpValue(add))).toEqual(add);
    const remove = {
      op: "remove" as const,
      groupId: "grp_vehicles",
      instanceId: "ins_7k2",
      token: "op_7f3",
    };
    expect(rosterOpValue(remove)).toBe("remove:grp_vehicles:ins_7k2:op_7f3");
    expect(parseRosterOpValue(rosterOpValue(remove))).toEqual(remove);
  });

  it("refuses everything that is not exactly that shape", () => {
    for (const hostile of [
      "",
      "add",
      "add:grp_vehicles",
      "add:grp_vehicles:op_7f3:extra",
      "remove:grp_vehicles:op_7f3",
      "remove:grp_vehicles:ins_7k2",
      "remove::ins_7k2:op_7f3",
      "drop:grp_vehicles:op_7f3",
      "ADD:grp_vehicles:op_7f3",
    ]) {
      expect(parseRosterOpValue(hostile), hostile).toBeUndefined();
    }
  });
});

describe("expansion clones the template per live instance", () => {
  it("emits one instance per roster entry, in roster order, with qualified names", () => {
    const { document } = goldenStep(OPEN_GROUP, "stp_fleet");
    const roster = instances(3);
    const expanded = expandRepeatGroups(document.root, {
      rosters: { grp_vehicles: roster },
    });
    const json = JSON.stringify(expanded);
    for (const [index, instanceId] of roster.entries()) {
      expect(json).toContain(`"${qualifiedFieldName(instanceId, "q_rep_plate")}"`);
      expect(json).toContain(`"Vehicle ${String(index + 1)}"`);
    }
    // The bare template name is gone: the qualified name is the field's whole
    // identity below the API, so nothing downstream ever sees `q_rep_plate` alone.
    expect(json).not.toContain('"name":"q_rep_plate"');
    // Roster order, not id order.
    const first = json.indexOf(roster[0]);
    const last = json.indexOf(roster[2]);
    expect(first).toBeLessThan(last);
  });

  it("leaves a document with no group referentially unchanged", () => {
    const { document } = goldenStep("minimal", "stp_only") as unknown as {
      document: A2UIStepDocument;
    };
    expect(hasRepeatGroup(document.root)).toBe(false);
    expect(expandRepeatGroups(document.root, { rosters: {} })).toBe(document.root);
  });

  it("is idempotent, so expanding an expanded tree changes nothing", () => {
    const { document } = goldenStep(OPEN_GROUP, "stp_fleet");
    const once = expandRepeatGroups(document.root, { rosters: { grp_vehicles: instances(2) } });
    const twice = expandRepeatGroups(once, { rosters: { grp_vehicles: instances(5) } });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("renders no instance and no member control with no roster", () => {
    const { document, spec } = goldenStep(OPEN_GROUP, "stp_fleet");
    const { container } = render(<A2UIStepRenderer document={document} specVersion={spec} />);
    // The group's chrome is there (a stored document drawn verbatim by the admin's
    // version view must not blow up), and the question outside the group still is.
    expect(container.querySelector("[data-qcms-repeat-group]")).not.toBeNull();
    expect(names(container)).toEqual(["q_rep_fleet_name"]);
  });

  it("prunes per instance against the qualified visible set", () => {
    const { document, spec } = goldenStep(OPEN_GROUP, "stp_fleet");
    const roster = instances(2);
    // `q_rep_service_date` is visible in instance 1 and hidden in instance 2, which
    // is exactly what a rule targeting inside a group produces: it is evaluated once
    // per live instance, so the visible set is per instance and the bare name is not
    // a thing the API ever sends.
    const visible = new Set([
      "q_rep_fleet_name",
      qualifiedFieldName(roster[0], "q_rep_plate"),
      qualifiedFieldName(roster[0], "q_rep_service_date"),
      qualifiedFieldName(roster[1], "q_rep_plate"),
    ]);
    const { container } = render(
      <A2UIStepRenderer
        document={documentForVisible(document, [...visible])}
        specVersion={spec}
        repeat={{ rosters: { grp_vehicles: roster }, visible }}
      />,
    );
    expect(names(container)).toEqual([
      "q_rep_fleet_name",
      qualifiedFieldName(roster[0], "q_rep_plate"),
      qualifiedFieldName(roster[0], "q_rep_service_date"),
      qualifiedFieldName(roster[1], "q_rep_plate"),
    ]);
  });

  // --- the per-instance step view (task 076, ADR-28 as amended 2026-09-29) ---------

  it("draws one instance for a per-instance step view, keeping its roster ordinal", () => {
    const { document, spec } = goldenStep(OPEN_GROUP, "stp_fleet");
    const roster = instances(3);
    const { container } = render(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        repeat={{
          rosters: { grp_vehicles: roster },
          view: { groupId: "grp_vehicles", instanceId: roster[1] },
        }}
      />,
    );
    // Vehicle 2 alone, and still called Vehicle 2: the ordinal is its place in the FULL
    // roster, never its place in a one-element list.
    expect(container.querySelectorAll("[data-qcms-instance]")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Vehicle 2" })).toBeTruthy();
    expect(names(container).filter((name) => name.startsWith("ins_"))).toEqual([
      qualifiedFieldName(roster[1], "q_rep_plate"),
      qualifiedFieldName(roster[1], "q_rep_service_date"),
      qualifiedFieldName(roster[1], "q_rep_odometer"),
    ]);
    // The step's own question is on the page: a view narrows the step to one instance of
    // the paginating group and to nothing else.
    expect(names(container)).toContain("q_rep_fleet_name");
  });

  it("puts the Add control on the last view and on no earlier one", () => {
    const { document, spec } = goldenStep(OPEN_GROUP, "stp_fleet");
    const roster = instances(3);
    const addOn = (instanceId: string): boolean => {
      const { container } = render(
        <A2UIStepRenderer
          document={document}
          specVersion={spec}
          repeat={{
            rosters: { grp_vehicles: roster },
            opToken: "op_7f3",
            view: { groupId: "grp_vehicles", instanceId },
          }}
          nativeSubmit={{ action: "/s/ses_1/step", submitLabel: "Continue" }}
        />,
      );
      return container.querySelector('[data-qcms-repeat-action="add"]') !== null;
    };
    expect(addOn(roster[0])).toBe(false);
    expect(addOn(roster[1])).toBe(false);
    // No Add markup at all rather than a disabled button: a disabled Add reads as "this
    // group is full" to a respondent whose group is not.
    expect(addOn(roster[2])).toBe(true);
  });

  it("leaves a stacked group on the same step untouched by the narrowing", () => {
    // A step may hold a paginating group beside a stacked one. Only the group the view
    // names is narrowed; every instance of the other belongs on every page.
    const { document, spec } = goldenStep(COUNT_SOURCES, "stp_drivers");
    const roster = instances(2);
    const { container } = render(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        repeat={{
          rosters: { grp_drivers: roster },
          view: { groupId: "grp_elsewhere", instanceId: "ins_zz" },
        }}
      />,
    );
    expect(container.querySelectorAll("[data-qcms-instance]")).toHaveLength(2);
  });

  it("counts the group's max against the full roster, not the drawn instance", () => {
    const { document, spec } = goldenStep(OPEN_GROUP, "stp_fleet");
    const roster = instances(9);
    const { container } = render(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        repeat={{
          rosters: { grp_vehicles: roster },
          opToken: "op_7f3",
          view: { groupId: "grp_vehicles", instanceId: roster[8] },
        }}
        nativeSubmit={{ action: "/s/ses_1/step", submitLabel: "Continue" }}
      />,
    );
    // One instance drawn, nine live, `max: 9`: the Add is offered on the last view and
    // disabled, because it is the ROSTER that is full and not the page.
    const add = container.querySelector<HTMLButtonElement>('[data-qcms-repeat-action="add"]');
    expect(add?.disabled).toBe(true);
  });

  it("documentForVisible keeps the template whole, because it cannot prune it", () => {
    const { document } = goldenStep(OPEN_GROUP, "stp_fleet");
    // Only the qualified names are in the visible set, so pruning the template by
    // name would delete every member control before the renderer could clone one.
    const pruned = documentForVisible(document, ["q_rep_fleet_name"]);
    expect(JSON.stringify(pruned)).toContain('"q_rep_plate"');
  });
});

describe("the instance card (plan section 4.3, Q11, Q12)", () => {
  function renderOpen(count: number, native = false) {
    const { document, spec } = goldenStep(OPEN_GROUP, "stp_fleet");
    const roster = instances(count);
    const result = render(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        repeat={{ rosters: { grp_vehicles: roster }, opToken: "op_7f3" }}
        {...(native ? { nativeSubmit: { action: "/s/ses_1/step", submitLabel: "Continue" } } : {})}
      />,
    );
    return { ...result, roster };
  }

  it("groups each instance as a fieldset whose legend holds the instance heading", () => {
    const { container, roster } = renderOpen(2);
    const cards = container.querySelectorAll("fieldset[data-qcms-instance]");
    expect(cards).toHaveLength(2);
    for (const [index, instanceId] of roster.entries()) {
      const card = container.querySelector<HTMLElement>(
        `fieldset[data-qcms-instance="${instanceId}"]`,
      );
      expect(card).not.toBeNull();
      const legend = card!.querySelector("legend");
      expect(legend).not.toBeNull();
      // The heading is INSIDE the legend: one element naming the group and reachable
      // by heading navigation, with the label spoken once rather than twice.
      const heading = legend!.querySelector("h4");
      expect(heading?.textContent).toBe(`Vehicle ${String(index + 1)}`);
      // The two focus mechanisms Q11 needs: the scripted landing and the fragment.
      expect(heading?.id).toBe(instanceId);
      expect(heading?.getAttribute("tabindex")).toBe("-1");
    }
  });

  /**
   * The server-rendered HTML for a native step, which is what the `autofocus` assertions
   * below have to read.
   *
   * `render()` cannot answer them: on the client React applies `autoFocus` by CALLING
   * focus() on the mounted node and writes no attribute at all, so a client render of a
   * correctly wired tree has zero `[autofocus]` elements. The no-JS case IS the server's
   * HTML, so that is what this renders.
   */
  function nativeMarkup(roster: readonly string[], autofocusId: string): string {
    const { document, spec } = goldenStep(OPEN_GROUP, "stp_fleet");
    return renderToStaticMarkup(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        nativeSubmit={{ action: "/s/ses_1/step", submitLabel: "Continue" }}
        repeat={{ rosters: { grp_vehicles: [...roster] }, opToken: "op_7f3", autofocusId }}
      />,
    );
  }

  /**
   * Every start tag in a markup string carrying the `autofocus` attribute.
   *
   * Split on `<` and tested per tag rather than matched with one expression over the whole
   * document, because an expression with two unbounded `[^>]*` around the attribute
   * backtracks super-linearly on a long line and the lint gate refuses it.
   */
  function autofocusTags(markup: string): string[] {
    const tags: string[] = [];
    for (const fragment of markup.split("<")) {
      const tag = fragment.split(">")[0] ?? "";
      if (!/^[a-z][a-z0-9]*[ /]/.test(tag)) continue;
      if (/ autofocus[ =]/.test(tag) || tag.endsWith(" autofocus")) tags.push(`<${tag}>`);
    }
    return tags;
  }

  it("marks the autofocus target the host named, and nothing else", () => {
    // The no-JS landing after an Add or a Remove is an `autofocus` attribute on that
    // instance's heading, which is a 200-to-a-POST's only option: the response leaves the
    // browser on the POST's own URL and that URL carries no fragment (Q11, Q28).
    //
    // Asserted on the RENDERED ATTRIBUTE rather than on the prop, because the way this
    // broke was a renderer that accepted `autofocusId` and never put it in the repeat
    // context: the action returned the right id, the page rendered, and the focus move
    // was silently gone with nothing else looking wrong.
    const roster = instances(2);
    const second = roster[1] ?? "";
    const marked = autofocusTags(nativeMarkup(roster, second));
    expect(marked).toHaveLength(1);
    const tag = marked[0] ?? "";
    expect(tag).toContain(`id="${second}"`);
    expect(tag.startsWith("<h4")).toBe(true);
    // Two autofocus targets in one document leave which one wins to the browser, so the
    // first instance's heading must not be marked as well.
    expect(tag).not.toContain(roster[0] ?? "");
  });

  it("marks the group's Add button when that is where the host sends focus", () => {
    // A REPLAYED no-JS post minted nothing, so the landing is the Add button: the
    // instance the first post created is already on the page and focus has not moved.
    const marked = autofocusTags(nativeMarkup(instances(1), addButtonId("grp_vehicles")));
    expect(marked).toHaveLength(1);
    expect(marked[0] ?? "").toContain('data-qcms-repeat-action="add"');
  });

  it("marks nothing when the host names no destination", () => {
    const roster = instances(2);
    const { document, spec } = goldenStep(OPEN_GROUP, "stp_fleet");
    const markup = renderToStaticMarkup(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        nativeSubmit={{ action: "/s/ses_1/step", submitLabel: "Continue" }}
        repeat={{ rosters: { grp_vehicles: roster }, opToken: "op_7f3" }}
      />,
    );
    expect(autofocusTags(markup)).toEqual([]);
  });

  it("never shows the instance id as a label a respondent reads", () => {
    const { container, roster } = renderOpen(2);
    for (const element of container.querySelectorAll("legend, label, h3, h4, button")) {
      for (const instanceId of roster) {
        expect(element.textContent ?? "").not.toContain(instanceId);
      }
    }
  });

  it("renumbers the ordinals after a removal, and the ids do not move", () => {
    const roster = instances(3);
    const { document, spec } = goldenStep(OPEN_GROUP, "stp_fleet");
    const after = [roster[0], roster[2]];
    const { container } = render(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        repeat={{ rosters: { grp_vehicles: after } }}
      />,
    );
    const headings = Array.from(container.querySelectorAll("legend h4"));
    expect(headings.map((h) => h.textContent)).toEqual(["Vehicle 1", "Vehicle 2"]);
    // "Vehicle 2" is now the instance that used to be third: the ordinal is
    // presentation and the id is identity (ADR-42, R6 one level down).
    expect(headings[1]?.id).toBe(roster[2]);
  });

  it("puts one input per row: every control is a direct child of the single column", () => {
    // Case 37's structural half. The layout rule itself is one declaration in
    // `theme-components.css` (`grid-template-columns: 1fr`, no media query anywhere
    // that widens it), and the browser suite asserts the geometry at 390 and at the
    // widest project; what a jsdom test can prove is the structure the rule needs:
    // every control sits in the one-column container and nothing wraps two of them.
    const { container } = renderOpen(1);
    const column = container.querySelector<HTMLElement>(".qcms-repeat__fields");
    expect(column).not.toBeNull();
    const fields = Array.from(column!.querySelectorAll<HTMLElement>("[data-qcms-field]"));
    expect(fields).toHaveLength(3);
    for (const field of fields) {
      // `display: contents` wrappers, so the control's own box is the grid item; the
      // wrapper's parent is the column itself.
      expect(field.parentElement).toBe(column);
    }
  });

  it("carries exactly one honeypot decoy at ten instances (case 34, DOM half)", () => {
    const { container } = renderOpen(10, true);
    expect(container.querySelectorAll("fieldset[data-qcms-instance]")).toHaveLength(10);
    expect(container.querySelectorAll('input[name="website"]')).toHaveLength(1);
  });

  it("renders longText and multiChoice inside a group (case 38)", () => {
    const { document, spec } = goldenStep(COUNT_SOURCES, "stp_incidents");
    const roster = instances(2, "inc");
    const { container } = render(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        repeat={{ rosters: { grp_incidents: roster } }}
      />,
    );
    for (const instanceId of roster) {
      const textarea = container.querySelector(
        `[data-qcms-field="${qualifiedFieldName(instanceId, "q_rep_notes")}"] textarea`,
      );
      expect(textarea).not.toBeNull();
      const boxes = container.querySelectorAll(
        `[data-qcms-field="${qualifiedFieldName(instanceId, "q_rep_extras")}"] input[type="checkbox"]`,
      );
      expect(boxes).toHaveLength(3);
    }
  });

  it("reports no axe violation on a filled group", async () => {
    const { container } = renderOpen(3);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("the roster controls", () => {
  function renderGroup(options: {
    form?: string;
    stepId?: string;
    groupId?: string;
    count: number;
    native?: boolean;
    onAdd?: (groupId: string) => void;
    onRemove?: (groupId: string, instanceId: string) => void;
    status?: { groupId: string; message: string };
  }) {
    const form = options.form ?? OPEN_GROUP;
    const stepId = options.stepId ?? "stp_fleet";
    const groupId = options.groupId ?? "grp_vehicles";
    const { document, spec } = goldenStep(form, stepId);
    const roster = instances(options.count);
    return {
      ...render(
        <A2UIStepRenderer
          document={document}
          specVersion={spec}
          repeat={{
            rosters: { [groupId]: roster },
            opToken: "op_7f3",
            ...(options.onAdd ? { onAdd: options.onAdd } : {}),
            ...(options.onRemove ? { onRemove: options.onRemove } : {}),
            ...(options.status ? { status: options.status } : {}),
          }}
          {...(options.native === true
            ? { nativeSubmit: { action: "/s/ses_1/step", submitLabel: "Continue" } }
            : {})}
        />,
      ),
      roster,
    };
  }

  it("posts add and remove as named submit buttons without scripting", () => {
    const { container, roster } = renderGroup({ count: 2, native: true });
    const ops = Array.from(
      container.querySelectorAll<HTMLButtonElement>(`button[name="${ROSTER_OP_FIELD}"]`),
    );
    expect(ops.map((button) => button.value)).toEqual([
      `remove:grp_vehicles:${roster[0]}:op_7f3`,
      `remove:grp_vehicles:${roster[1]}:op_7f3`,
      "add:grp_vehicles:op_7f3",
    ]);
    // Every one of them skips browser validation, which is safe ONLY because the
    // post writes no answer (ADR-43, the ruling of 2026-09-30).
    for (const button of ops) {
      expect(button.type).toBe("submit");
      expect(button.hasAttribute("formnovalidate")).toBe(true);
    }
  });

  it("carries at most one __qop entry on the wire (case 30, the renderer half)", () => {
    // A `<button name value>` contributes its name and value only when it is the
    // button that submitted the form, so a whole-step POST carries exactly one
    // `__qop` entry or none. Asserted at the transport: the buttons are the ONLY
    // elements carrying that name, and none of them is an input that would serialize
    // whether pressed or not.
    const { container } = renderGroup({ count: 3, native: true });
    const named = Array.from(container.querySelectorAll(`[name="${ROSTER_OP_FIELD}"]`));
    expect(named).toHaveLength(4);
    for (const element of named) {
      expect(element.tagName).toBe("BUTTON");
    }
    expect(container.querySelectorAll(`input[name="${ROSTER_OP_FIELD}"]`)).toHaveLength(0);
  });

  it("offers no roster control on a count source whose size is not the respondent's", () => {
    for (const [stepId, groupId] of [
      ["stp_drivers", "grp_drivers"],
      ["stp_incidents", "grp_incidents"],
    ] as const) {
      const { container } = renderGroup({
        form: COUNT_SOURCES,
        stepId,
        groupId,
        count: 2,
        native: true,
      });
      expect(container.querySelectorAll(`[name="${ROSTER_OP_FIELD}"]`)).toHaveLength(0);
      expect(container.querySelectorAll("[data-qcms-repeat-action]")).toHaveLength(0);
    }
  });

  it("disables Add at the group's max", () => {
    const { container } = renderGroup({ count: 9, native: true });
    const add = container.querySelector<HTMLButtonElement>('[data-qcms-repeat-action="add"]');
    expect(add?.disabled).toBe(true);
  });

  it("calls the host's callbacks on the scripted path", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const { roster } = renderGroup({ count: 2, onAdd, onRemove });
    screen.getByRole("button", { name: "Add Vehicle" }).click();
    expect(onAdd).toHaveBeenCalledWith("grp_vehicles");
    screen.getByRole("button", { name: "Remove Vehicle 2" }).click();
    expect(onRemove).toHaveBeenCalledWith("grp_vehicles", roster[1]);
  });

  it("names the remove control with the distinguishing words first", () => {
    renderGroup({ count: 3, onRemove: () => undefined });
    // APG's naming practice: "Remove Vehicle 3", never "Vehicle 3 remove".
    expect(screen.getByRole("button", { name: "Remove Vehicle 3" })).toBeDefined();
  });

  it("announces through a polite status region on the scripted path only", () => {
    const scripted = renderGroup({
      count: 2,
      status: { groupId: "grp_vehicles", message: "Vehicle 3 added" },
    });
    const region = scripted.container.querySelector('[role="status"]');
    expect(region?.getAttribute("aria-live")).toBe("polite");
    // A whole sentence, never a changing number (4.1.3's own Understanding).
    expect(region?.textContent).toBe("Vehicle 3 added");
    scripted.unmount();

    const native = renderGroup({ count: 2, native: true });
    // Without scripting 4.1.3 does not apply: the criterion scopes out a message
    // delivered via a change in context, and a whole-page POST and re-render is one.
    expect(native.container.querySelector('[role="status"]')).toBeNull();
  });
});

describe("an embedded document renumbers both repeat headings exactly once", () => {
  it("demotes the group label and the instance label by the same offset", () => {
    const { document } = goldenStep(OPEN_GROUP, "stp_fleet");
    const expanded = expandRepeatGroups(document.root, {
      rosters: { grp_vehicles: instances(1) },
    });
    const demoted = withDemotedHeadings(expanded, 1);
    const json = JSON.stringify(demoted);
    // The group's label is a `Text` heading and moves h3 -> h4; the instance's is a
    // `RepeatInstance` prop and is clamped at h4, which is the documented tail
    // behaviour of the demotion list rather than a second rule.
    expect(json).toContain('"as":"h4","size":"lg"');
    expect(json).toContain('"headingAs":"h4"');
  });

  it("renders the embedded levels in the DOM", () => {
    const { document, spec } = goldenStep(OPEN_GROUP, "stp_fleet");
    const { container } = render(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        headingLevelOffset={1}
        repeat={{ rosters: { grp_vehicles: instances(1) } }}
      />,
    );
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(container.querySelector("legend h4")?.textContent).toBe("Vehicle 1");
  });
});
