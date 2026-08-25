/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#101623', soft: '#141B2A' },
        surface: { DEFAULT: '#1A2231', raised: '#222C3E' },
        line: { DEFAULT: '#2C3850', strong: '#3B4A66' },
        accent: {
          DEFAULT: '#5B9BFF',
          hover: '#4A8AF5',
          soft: 'rgba(91,155,255,0.18)',
          // Accent lisible sur `accent-soft`. Le #5B9BFF n'y donne que 3,76:1,
          // sous le seuil AA, et aucune opacité de fond ne l'y ramène : la
          // teinte elle-même est trop sombre. Celle-ci monte à 5,28:1 sans
          // changer de famille chromatique. Réservée au texte posé sur un fond
          // accentué — ailleurs, `accent` suffit.
          bright: '#8FBAFF',
        },
        success: { DEFAULT: '#3DDBA6', soft: 'rgba(61,219,166,0.16)' },
        warning: { DEFAULT: '#FCC63F', soft: 'rgba(252,198,63,0.16)' },
        danger: { DEFAULT: '#FF8080', soft: 'rgba(255,128,128,0.16)' },
        content: { DEFAULT: '#F7FAFF', muted: '#B4C0D4', faint: '#8A97AC' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 200ms cubic-bezier(0.16,1,0.3,1) both',
        'scale-in': 'scale-in 150ms cubic-bezier(0.16,1,0.3,1) both',
        'slide-up': 'slide-up 220ms cubic-bezier(0.16,1,0.3,1) both',
      },
    },
  },
  plugins: [],
};
