/**
 * Marques des applications de partage.
 *
 * Dessinées ici plutôt que tirées d'un paquet : la bibliothèque d'icônes du
 * projet n'en contient pas — elle s'en tient délibérément aux pictogrammes
 * d'interface — et un paquet de logos de marque n'entrerait dans les
 * dépendances que pour quatre glyphes.
 *
 * Chaque tracé porte `currentColor` : c'est le bouton qui décide de la
 * couleur, pas le logo. Un logo qui impose la sienne se voit mal sur un fond
 * sombre, et l'application n'a qu'un thème sombre.
 */

function Svg({ children, titre }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      role="img"
      aria-label={titre}
    >
      {children}
    </svg>
  );
}

export function LogoWhatsApp() {
  return (
    <Svg titre="WhatsApp">
      <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.16-1.35a9.9 9.9 0 0 0 4.88 1.28h.01c5.5 0 9.96-4.46 9.96-9.96S17.54 2 12.04 2Zm0 18.19h-.01a8.26 8.26 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.24 8.24 0 0 1-1.26-4.37c0-4.55 3.71-8.26 8.27-8.26 2.2 0 4.28.86 5.84 2.42a8.2 8.2 0 0 1 2.42 5.85c0 4.56-3.71 8.22-8.27 8.22Zm4.53-6.16c-.25-.13-1.47-.72-1.7-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23a7.5 7.5 0 0 1-1.38-1.72c-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.09-.16.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.84-.2-.48-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.54c.13.17 1.74 2.65 4.2 3.72.59.25 1.05.4 1.4.52.6.19 1.14.16 1.56.1.48-.07 1.47-.6 1.68-1.18.2-.58.2-1.07.15-1.18-.06-.1-.23-.17-.48-.29Z" />
    </Svg>
  );
}

export function LogoX() {
  return (
    <Svg titre="X">
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.22-6.82-5.96 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.11l11.97 15.64Z" />
    </Svg>
  );
}

export function LogoTelegram() {
  return (
    <Svg titre="Telegram">
      <path d="M21.94 4.3 18.9 19.1c-.23 1.03-.85 1.28-1.72.8l-4.75-3.5-2.29 2.2c-.25.26-.47.48-.96.48l.34-4.85 8.83-7.98c.38-.34-.08-.53-.6-.19L6.85 13.93l-4.7-1.47c-1.02-.32-1.04-1.02.21-1.51l18.37-7.08c.85-.31 1.6.2 1.21 2.43Z" />
    </Svg>
  );
}

export function LogoEmail() {
  return (
    <Svg titre="E-mail">
      <path d="M3 5.25h18c.41 0 .75.34.75.75v12c0 .41-.34.75-.75.75H3a.75.75 0 0 1-.75-.75V6c0-.41.34-.75.75-.75Zm.75 2.4V17.25h16.5V7.65l-7.83 5.47a1.5 1.5 0 0 1-1.72 0L3.75 7.65Zm15.3-.9H4.95L12 11.66l7.05-4.91Z" />
    </Svg>
  );
}

export const LOGOS = {
  whatsapp: LogoWhatsApp,
  x: LogoX,
  telegram: LogoTelegram,
  email: LogoEmail,
};
