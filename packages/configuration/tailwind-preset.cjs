/**
 * Shared Tailwind preset for both web apps. Brand/accent colours are CSS variables so each app (and,
 * in the HRMS, each tenant's configured accent) can theme itself at runtime without a rebuild.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: 'rgb(var(--brand) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        ink: '#0f172a',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'] },
    },
  },
  plugins: [],
};
