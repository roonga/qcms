/**
 * The portal's hydration marker attribute, in one place (issue #159).
 *
 * A plain module with no React and no Next import, deliberately: it is the single
 * source of truth for a string that two very different consumers have to agree on -
 * `components/hydration-marker.tsx`, which writes it in a mount effect, and
 * `e2e/support/hydration.ts`, which waits for it. Two literals would compile,
 * review cleanly, and silently turn the e2e wait into an unconditional timeout the
 * day either one is edited. Keeping it importable from the Playwright process is
 * the whole point, which is why nothing renderable lives here.
 */

/**
 * Stamped on `<html>` once React has committed a portal root, and absent from every
 * server render. Presence-only: nothing reads the value.
 */
export const HYDRATED_ATTRIBUTE = "data-qcms-hydrated";

/** The selector form of {@link HYDRATED_ATTRIBUTE}. */
export const HYDRATED_SELECTOR = `[${HYDRATED_ATTRIBUTE}]`;
