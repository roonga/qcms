/**
 * The portal's hydration marker attribute.
 *
 * No React and no Next import, so the Playwright process can import it too: two
 * literals would compile and review cleanly, then turn the e2e wait into an
 * unconditional timeout the day either one is edited.
 */

/** Stamped on `<html>` once React has committed a portal root. Presence-only. */
export const HYDRATED_ATTRIBUTE = "data-qcms-hydrated";

export const HYDRATED_SELECTOR = `[${HYDRATED_ATTRIBUTE}]`;
