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
        // SF Pro sur les appareils Apple, Inter ailleurs : la même famille de
        // grotesques à chasse serrée.
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        display: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg: '12px',
        xl: '16px',
        '2xl': '22px',
        '3xl': '28px',
      },
      boxShadow: {
        carte: 'var(--ombre-carte)',
        haute: 'var(--ombre-haute)',
        bouton: 'var(--ombre-bouton)',
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
        // Ressort à léger dépassement, celui des contrôles d'iOS.
        ressort: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        // Feuilles et panneaux : départ vif, arrivée très douce.
        feuille: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      keyframes: {
        // Le flou qui se dissipe est la signature des transitions d'Apple :
        // le contenu « fait le point » en arrivant.
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(10px) scale(0.99)', filter: 'blur(6px)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.92)', filter: 'blur(4px)' },
          to: { opacity: '1', transform: 'scale(1)', filter: 'blur(0)' },
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
        'fade-in-up': 'fade-in-up 520ms cubic-bezier(0.16,1,0.3,1) both',
        'scale-in': 'scale-in 420ms cubic-bezier(0.34,1.36,0.4,1) both',
        'slide-up': 'slide-up 480ms cubic-bezier(0.32,0.72,0,1) both',
        flottement: 'flottement 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
