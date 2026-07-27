/**
 * Tailwind v4 via its PostCSS plugin (task 031). The admin's screens are ordinary
 * React over the same vendored a2-react-aria components as the portal (ADR-22,
 * imported from `@qcms/ui/kit`), and those style themselves with Tailwind utility
 * classes over the theme.css custom properties, so the admin build must run
 * Tailwind too. Content sources are declared with `@source` in globals.css.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
