/** @type {import('tailwindcss').Config} */
// Design tokens ported from Theme.swift. One place owns every color, radius,
// and spring in the app.
//
// Principles carried over from the iOS build:
// - Dark, premium, sporty: near-black with a green cast (never pure #000),
//   deep fairway green as the brand anchor, electric lime reserved for MONEY
//   and WINS so it stays special, muted coral for "down" (red-green
//   colorblind-safer than pure red against green).
// - Outdoor legibility is a hard requirement: body text >= 17px, no
//   informational text below 60% white, hit targets >= 48px for gloved thumbs
//   in sunlight.
// - Scores are numbers in motion: rounded design + tabular digits so steppers
//   don't jitter.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0A0F0D',
        surface: '#141B18',
        raised: '#1C2521',
        stroke: '#2A3630',
        fairway: {
          DEFAULT: '#1F9D55',
          pressed: '#177A41',
        },
        money: '#B7F435',
        down: '#FF7A6B',
        neutral: '#93A69C',
        gold: '#FFD34D',
        text: {
          primary: '#F4F9F6',
          secondary: '#AABBB2',
          onAccent: '#07130C',
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
      minHeight: {
        target: '48px',
      },
      minWidth: {
        target: '48px',
      },
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
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        // Roughly the three Swift springs: snappy, standard, celebratory.
        'pop-in': 'pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'slide-up': 'slide-up 0.42s cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-in': 'fade-in 0.28s ease-out',
      },
    },
  },
  plugins: [],
};
