import type { ComponentProps } from "react";
import { FormContext } from "react-aria-components";

import { Form } from "./components/a2ui/form/index.ts";
import { getFormStyles } from "./components/a2ui/form/form.styles.ts";
import { useQcmsFormAction } from "./field-context.tsx";

/**
 * The vendored component's own props, so this adapter is held to exactly the shape it
 * delegates to rather than to the A2UI schema's wider one (the schema types `target` as
 * a string; the component narrows it to the four legal values).
 */
type FormProps = ComponentProps<typeof Form>;

/**
 * The qcms adapter for the root `Form` node (task 073).
 *
 * It exists for exactly one reason: **a form's action may be a function.** Without
 * scripting, a repeating group's Add and Remove post to a Next Server Action, which
 * runs the roster operation and re-renders the step in the same 200 response, and that
 * is what carries the respondent's typed values back with no cookie and no redirect
 * (ADR-43 as amended, Code Owner 2026-10-01). React puts a Server Action on a form by
 * `<form action={fn}>`, and the vendored `Form`'s `action` prop is typed and forwarded
 * as a string, as the A2UI schema declares it.
 *
 * **The vendored component is untouched and is still what renders every other step.**
 * ADR-22 freezes `src/components/a2ui/**` byte for byte, so this adapter delegates to
 * it whenever no function action is supplied, which is every step with no repeating
 * group and every step on the scripted path. That keeps the conformance corpus
 * rendering through the vendored component exactly as it did.
 *
 * When a function IS supplied, this renders the `<form>` itself. What it reproduces
 * from the vendored wrapper is deliberate and small: the same class from
 * `getFormStyles(gap)`, so the layout is identical, and react-aria's
 * `validationBehavior` context, which is the one behaviour the vendored wrapper
 * establishes for the controls beneath it (`native` by default, which is what the no-JS
 * path wants: the browser validates every control except the `formnovalidate` roster
 * buttons). `validationErrors` is not reproduced because it is the scripted path's
 * channel and this branch is the native one, where each control carries its own
 * `errorMessage`.
 */
export function FormField(props: Readonly<FormProps>) {
  const formAction = useQcmsFormAction();
  const { gap = "md", validationBehavior = "native", children, ...rest } = props;
  if (formAction === undefined) {
    return <Form {...props} />;
  }
  // The props are named rather than spread, because `method` must NOT be forwarded and
  // the reason is a hydration mismatch rather than tidiness. React owns the method when
  // the action is a function - a function action is always a POST - and its SSR output
  // spells it `POST`, while the stored node's prop spells it `post`. Forwarding the prop
  // produced `method="POST"` in the server HTML against `method="post"` on the client,
  // which React reports as an unpatchable attribute mismatch and the portal's browser
  // gate reports as a console error. `validationErrors` and the three `on*` handlers are
  // not forwarded either: they are the scripted path's channel and this branch is the
  // native one, where each control carries its own `errorMessage`.
  return (
    <FormContext.Provider value={{ validationBehavior }}>
      <form
        action={formAction}
        className={getFormStyles(gap)}
        encType={rest.encType}
        autoComplete={rest.autoComplete}
        target={rest.target}
      >
        {children}
      </form>
    </FormContext.Provider>
  );
}
