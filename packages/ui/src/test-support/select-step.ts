import type { A2UIStepDocument } from "../A2UIStepRenderer.tsx";

// The one question type no golden document exercises: a single choice above the
// compiler's Select threshold. A synthetic test input, not a golden.
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
