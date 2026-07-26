import type { A2UIStepDocument } from "../A2UIStepRenderer.tsx";

/**
 * The one question type no golden document exercises: `singleChoice` with more
 * options than the compiler's Select threshold, which compiles to a `Select`
 * rather than a `RadioGroup` (`docs/a2ui-mapping.md`). A tiny synthetic fixture -
 * not a golden, just a test input - shared by the round-trip suite (the Select
 * emits an OptionId) and the clear-path suite (the Select has no clear gesture).
 */
export const SELECT_STEP: A2UIStepDocument = {
  stepId: "stp_select",
  root: {
    type: "Form",
    children: [
      {
        type: "Flex",
        props: { direction: "column", gap: "md" },
        children: [
          { type: "Text", props: { as: "h2" }, children: "Where do you live?" },
          {
            type: "Select",
            props: {
              label: "Country",
              name: "q_country",
              isRequired: true,
              items: [
                { value: "opt_au", label: "Australia" },
                { value: "opt_nz", label: "New Zealand" },
                { value: "opt_us", label: "United States" },
                { value: "opt_ca", label: "Canada" },
                { value: "opt_gb", label: "United Kingdom" },
                { value: "opt_ie", label: "Ireland" },
                { value: "opt_de", label: "Germany" },
                { value: "opt_fr", label: "France" },
              ],
            },
          },
          {
            type: "Honeypot",
            props: { name: "website", autoComplete: "off", ariaHidden: true, tabIndex: -1 },
          },
        ],
      },
    ],
  },
};
