/** Qwik Licence & Subscription Manager theme: deep navy brand with Qwik gold accent (visually distinct from the HRMS). */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { brand: 'rgb(var(--brand) / <alpha-value>)', accent: 'rgb(var(--accent) / <alpha-value>)' },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'] },
    },
  },
  plugins: [],
};
