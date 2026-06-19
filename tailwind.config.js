/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Brand dark palette ──────────────────────────────────────────────
        app: '#0A1A30', // page background (deep navy)
        surface: '#1E2D45', // cards / panels / modals
        surfaceBorder: '#324567', // card & input borders
        field: '#16263E', // input / select / textarea backgrounds
        track: '#12233C', // progress-bar track
        ink: '#E8EDF2', // primary text
        muted: '#8A9BB5', // secondary / muted text & placeholders
        accent: '#F07010', // primary buttons, fills, active states, links
        accentHover: '#FF8A2B',
        // Semantic, tuned for dark
        success: '#4ABE7C',
        warning: '#E0A02B',
        danger: '#E2544A',

        // ── Legacy tokens remapped onto the brand palette ───────────────────
        // Existing classes (text-charcoal, bg-amber, hover:bg-amber-700,
        // text-amber-700, focus:ring-amber, accent-amber) now resolve to the
        // dark theme automatically — accent orange + light ink text.
        amber: {
          DEFAULT: '#F07010',
          600: '#F07010',
          700: '#FF8A2B',
        },
        charcoal: '#E8EDF2',
      },
    },
  },
  plugins: [],
}
