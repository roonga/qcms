/**
 * The rail slot's answer for every route that has no rail (issue 559).
 *
 * `plan/admin-ux-audit.md` §3 and §5.4 reject a rail on the six deployment-level and
 * library screens outright: a rail there would either be empty or would repeat the page's
 * own body, "and now there are two of them and they can disagree". So the slot's default
 * is nothing at all, and `app/globals.css` keys the two-track grid off a rail actually
 * being present, which is what keeps those screens rendering exactly as they did.
 *
 * This file is also what stops the slot from going stale on a soft navigation. Without a
 * `default`, Next keeps whichever rail was last matched when the new URL has no match for
 * the slot, so walking from a form to `/questions` would leave that form's rail on screen
 * beside a screen it says nothing about.
 */
export default function RailDefault(): null {
  return null;
}
