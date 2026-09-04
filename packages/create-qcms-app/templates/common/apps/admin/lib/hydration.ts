/**
 * The admin's "React has attached" marker attribute, in one place (issue #210).
 *
 * No React import and no Next import, deliberately, because the two things that have to
 * agree on this string could not be further apart: `components/hydration-marker.tsx`
 * writes it from a mount effect inside the browser, and `e2e/support/hydration.ts` waits
 * for it from the Playwright runner. Two literals would compile, review cleanly, and turn
 * every wait in the admin suite into an unconditional timeout the day either one is
 * edited. Keeping this module importable from a Node process is the whole point.
 *
 * ## Why the admin has its own copy of the portal's constant
 *
 * The same attribute name, written down twice, in `apps/portal/lib/hydration.ts` and here.
 * That is the rule this repository already applies to a contract two separate deployables
 * share (`lib/server/auth-api.ts` does it for better-auth's cookie names): the apps have no
 * shared runtime package between them, `@qcms/e2e-support` is a devDependency and cannot be
 * imported by app code, and inventing a runtime dependency to carry one string would be a
 * larger change than the string. The name is identical on purpose - an operator or a
 * reviewer reading `data-qcms-hydrated` in either app is reading the same claim.
 */

/**
 * Stamped on `<html>` once React has committed the admin's root, and absent from every
 * server render. Presence-only: nothing reads the value.
 */
export const HYDRATED_ATTRIBUTE = "data-qcms-hydrated";

/** The selector form of {@link HYDRATED_ATTRIBUTE}. */
export const HYDRATED_SELECTOR = `[${HYDRATED_ATTRIBUTE}]`;
