/** Vendored controls use Tailwind utilities over theme variables; this app must run the PostCSS plugin too. */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
