/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#e8f8fa', 100: '#c8eef2', 500: '#0e9aa7', 600: '#0b7a85', 700: '#09646d', 900: '#04353b' },
        ink: { 900: '#0b1b2b', 800: '#12283c', 700: '#1d3a52' },
      },
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'], display: ['Sora', '"Plus Jakarta Sans"', 'sans-serif'] },
    },
  },
  plugins: [],
};
