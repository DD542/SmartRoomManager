/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Les valeurs elles-mêmes vivent dans `src/index.css`, en triplets RVB,
      // pour qu'un attribut sur `<html>` change de thème sans reconstruire la
      // feuille de style.
      //
      // `<alpha-value>` est le point important : c'est lui qui laisse Tailwind
      // injecter une opacité dans la variable. Le dépôt compte 98 usages du
      // genre `border-accent/40` — écrites en hexadécimal, ces variables les
      // auraient tous privés de transparence, sans erreur pour le signaler.
      //
      // Les jetons `soft` portent leur alpha dans la variable et n'acceptent
      // donc pas de modificateur. Aucun `-soft/NN` n'existe dans le dépôt, et
      // leur opacité doit rester réglable par thème : la même transparence ne
      // rend pas le même effet sur un fond sombre et sur un fond clair.
      colors: {
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft))',
          // Accent lisible sur `accent-soft`, où l'accent ordinaire tombe sous
          // le seuil AA. Réservé au texte posé sur un fond accentué.
          bright: 'rgb(var(--accent-bright) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          soft: 'rgb(var(--success-soft))',
        },
        warning: {
          DEFAULT: 'rgb(var(--warning) / <alpha-value>)',
          soft: 'rgb(var(--warning-soft))',
        },
        danger: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
          soft: 'rgb(var(--danger-soft))',
        },
        content: {
          DEFAULT: 'rgb(var(--content) / <alpha-value>)',
          muted: 'rgb(var(--content-muted) / <alpha-value>)',
          faint: 'rgb(var(--content-faint) / <alpha-value>)',
        },
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
      // Échelle unique et documentée des plans d'affichage. Toute superposition
      // se résout en plaçant l'élément ici, jamais en inventant une valeur dans
      // un composant. L'ordre suit une règle simple : plus une surface exige
      // une décision de l'utilisateur, plus elle monte.
      //
      // `chatbubble` passe volontairement SOUS `mobilenav` : la bulle flottait
      // au-dessus de la barre d'onglets et rendait « Profil » intouchable au
      // doigt. Déployé, le panneau remonte au-dessus des modales — c'est alors
      // lui qui porte la conversation en cours.
      zIndex: {
        base: '0', //         contenu de page
        sticky: '10', //      en-têtes de tableau collants, barres d'action
        topbar: '20', //      barre supérieure
        chatbubble: '25', //  bulle repliée de l'assistant
        mobilenav: '30', //   barre d'onglets basse
        menu: '40', //        menus contextuels ancres a leur declencheur
        drawer: '50', //      tiroirs et feuilles inférieures
        modal: '60', //       modales
        chatpanel: '70', //   assistant déployé
        toast: '80', //       notifications éphémères
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
        flottement: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 200ms cubic-bezier(0.16,1,0.3,1) both',
        'scale-in': 'scale-in 150ms cubic-bezier(0.16,1,0.3,1) both',
        'slide-up': 'slide-up 220ms cubic-bezier(0.16,1,0.3,1) both',
        flottement: 'flottement 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
