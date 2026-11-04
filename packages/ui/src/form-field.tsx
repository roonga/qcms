import type { ComponentProps } from "react";
import { FormContext } from "react-aria-components";

import { Form } from "./components/a2ui/form/index.ts";
import { getFormStyles } from "./components/a2ui/form/form.styles.ts";
import { useQcmsFormAction, useQcmsFormHiddenFields } from "./field-context.tsx";

// The component's props, not the A2UI schema's wider ones: the schema types `target`
// as a string where the component narrows it to the four legal values.
type FormProps = ComponentProps<typeof Form>;

/** The vendored Form cannot forward function actions. Delegate string actions to it and adapt only Server Actions. */
export function FormField(props: Readonly<FormProps>) {
  const formAction = useQcmsFormAction();
  const hiddenFields = useQcmsFormHiddenFields();
  const { gap = "md", validationBehavior = "native", children, ...rest } = props;
  if (formAction === undefined) {
    return <Form {...props} />;
  }
  // Named rather than spread because `method` must not be forwarded: React owns it for
  // a function action and spells it `POST` against the stored node's `post`, which is
  // an unpatchable hydration mismatch.
  return (
    <FormContext.Provider value={{ validationBehavior }}>
      <form
        action={formAction}
        className={getFormStyles(gap)}
        encType={rest.encType}
        autoComplete={rest.autoComplete}
        target={rest.target}
      >
        {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {children}
      </form>
    </FormContext.Provider>
  );
}
