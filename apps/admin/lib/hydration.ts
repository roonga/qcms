/** Keep this browser/test contract importable from Node without React or Next dependencies. A mismatched marker would make every browser wait time out. */

/** Presence is stamped only after the root commits, never in server HTML. */
export const HYDRATED_ATTRIBUTE = "data-qcms-hydrated";

export const HYDRATED_SELECTOR = `[${HYDRATED_ATTRIBUTE}]`;
