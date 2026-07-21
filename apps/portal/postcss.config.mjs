/**
 * Tailwind v4 via its PostCSS plugin (task 029). The a2-react-aria components the
 * portal renders (through @qcms/ui) style themselves with Tailwind utility
 * classes over the theme.css custom properties (ADR-22), so the portal build
 * must run Tailwind. Content sources are declared with `@source` in globals.css.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
