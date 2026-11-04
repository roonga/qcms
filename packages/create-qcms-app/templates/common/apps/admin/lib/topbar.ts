/** Measure wrapped navigation and environment borders for rail geometry and scroll padding; fixed token height can hide focused controls. ResizeObserver tracks actual content rather than guessing rows from viewport width. */

/** Leave the measured variable absent until the first observation so CSS can use the derived fallback. */
export const TOPBAR_HEIGHT_PROPERTY = "--admin-topbar-measured-h";

export const TOPBAR_SELECTOR = "header.qcms-topbar";

export const TOPBAR_LAYOUT_HEIGHT_PROPERTY = "--admin-topbar-layout-h";
