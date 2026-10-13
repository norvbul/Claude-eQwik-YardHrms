/** eQwik YardHRMS theme: Qwik green brand (tenant accent can override --brand at runtime) + Jamaican gold accent. */
module.exports = {
  presets: [require('@yardhrms/configuration/tailwind-preset')],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};
