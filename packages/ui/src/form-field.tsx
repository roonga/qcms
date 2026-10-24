import type { ComponentProps } from "react";
import { FormContext } from "react-aria-components";

import { Form } from "./components/a2ui/form/index.ts";
import { getFormStyles } from "./components/a2ui/form/form.styles.ts";
import { useQcmsFormAction, useQcmsFormHiddenFields } from "./field-context.tsx";

/**
 * The vendored component's own props, so this adapter is held to exactly the shape it
 * delegates to rather than to the A2UI schema's wider one (the schema types `target` as
 * a string; the component narrows it to the four legal values).
 */
type FormProps = ComponentProps<typeof Form>;

/**
 * The qcms adapter for the root `Form` node.
 *
 * It exists because a form's action may be a function: without scripting, a repeating
 * group's Add and Remove post to a Server Action that re-renders the step in the same
 * 200 response (ADR-43 as amended). The vendored `Form` types and forwards `action` as
 * a string, as the A2UI schema declares it, and ADR-22 freezes it byte for byte, so
 * this delegates to it whenever no function action is supplied.
 *
 * When one is, this renders the `<form>` itself and reproduces only the vendored
 * wrapper's class from `getFormStyles(gap)` and its react-aria `validationBehavior`
 * context (`native`, so the browser validates every control except the
 * `formnovalidate` roster buttons).
 */
export function FormField(props: Readonly<FormProps>) {
  const formAction = useQcmsFormAction();
  const hiddenFields = useQcmsFormHiddenFields();
  const { gap = "md", validationBehavior = "native", children, ...rest } = props;
  if (formAction === undefined) {
    return <Form {...props} />;
  }
  // Props are named rather than spread because `method` must not be forwarded: React
  // owns it when the action is a function and spells it `POST` in SSR output against the
  // stored node's `post`, which is an unpatchable hydration mismatch. `validationErrors`
  // and the `on*` handlers belong to the scripted path, not to this native one.
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
