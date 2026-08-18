/** @type {import('tailwindcss').Config} */
// Design tokens. One place owns every color, radius, and spring in the app.
//
// The palette is a dark violet system in the PrizePicks vein: a near-black
// ground with a purple undertone, a vivid violet as the brand anchor, and
// electric lime reserved for MONEY and WINS so it always earns attention.
// Principles inherited from the original SwiftUI build still hold:
// - Never pure #000 — it kills depth and smears on OLED.
// - Outdoor legibility is a hard requirement: body text >= 17px, no
//   informational text below 60% white, hit targets >= 48px for gloved thumbs
//   in sunlight. Violet is darker than the old green, so text on surfaces was
//   re-checked for contrast rather than assumed.
// - Scores are numbers in motion: rounded design + tabular digits so steppers
//   don't jitter.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0B0912',
        surface: '#151122',
        raised: '#1F1830',
        stroke: '#342A4A',
        // Brand violet. Buttons, selected states, anything the thumb goes to.
        primary: {
          DEFAULT: '#7C3AED',
          pressed: '#6926D9',
          bright: '#A855F7',
        },
        // Electric lime — money, wins, "up". Reads hot against violet and is
        // the one color that never appears decoratively.
        money: '#B7F435',
        // Losses, "down". Warm pink-red, not alarm-red, and distinguishable
        // from violet for red-green colorblind viewers.
        down: '#FF6B7A',
        // Halved / neutral states.
        neutral: '#9A90B8',
        // Jackpot moments (ace, albatross).
        gold: '#FBBF24',
        text: {
          primary: '#F5F2FF',
          secondary: '#B4A9D4',
          // Violet is dark enough that its foreground is white, unlike the
          // lime and green surfaces this palette replaced.
          onAccent: '#FFFFFF',
          // For the rare lime/gold fill, which needs a dark foreground.
          onBright: '#140A24',
        },
      },
      borderRadius: {
        chip: '10px',
        card: '18px',
        button: '14px',
      },
      fontFamily: {
        rounded: [
          'ui-rounded',
          '"SF Pro Rounded"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'system-ui',
          'sans-serif',
        ],
      },
      fontSize: {
        'score-xl': ['84px', { lineHeight: '1', fontWeight: '700' }],
        display: ['32px', { lineHeight: '1.1', fontWeight: '700' }],
        title: ['22px', { lineHeight: '1.2', fontWeight: '700' }],
        headline: ['17px', { lineHeight: '1.3', fontWeight: '600' }],
        body: ['17px', { lineHeight: '1.45' }],
        caption: ['13px', { lineHeight: '1.3', fontWeight: '500' }],
        'money-lg': ['28px', { lineHeight: '1.1', fontWeight: '800' }],
        grid: ['15px', { lineHeight: '1.2', fontWeight: '600' }],
      },
      backgroundImage: {
        // Hero surfaces: a violet wash that lifts the top of a screen without
        // costing legibility further down.
        'violet-hero': 'linear-gradient(160deg, #3B1E6E 0%, #1B1230 55%, #0B0912 100%)',
        'violet-tile': 'linear-gradient(145deg, #7C3AED 0%, #5B21B6 100%)',
      },
      boxShadow: {
        glow: '0 0 24px -4px rgba(124, 58, 237, 0.55)',
        'glow-money': '0 0 24px -6px rgba(183, 244, 53, 0.45)',
      },
      minHeight: { target: '48px' },
      minWidth: { target: '48px' },
      keyframes: {
        'pop-in': {
          '0%': { transform: 'scale(0.86)', opacity: '0' },
          '60%': { transform: 'scale(1.04)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      },
      animation: {
        'pop-in': 'pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'slide-up': 'slide-up 0.42s cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-in': 'fade-in 0.28s ease-out',
      },
    },
  },
  plugins: [],
};
