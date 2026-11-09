import { cn } from '../../utils/cn';

/**
 * Monogramme « S » de SmartRoom : un seul trait, arrondi aux deux bouts.
 *
 * Dessiné en `currentColor` : il prend la teinte du texte qui l'entoure,
 * graphite sur le thème clair, blanc sur le sombre, sans variante à tenir.
 */
export function LogoMark({ size = 28, className }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <path
        d="M22.6 9.6c-.8-2.6-3.4-4.3-6.8-4.3-4 0-6.9 2.2-6.9 5.3 0 6.9 14.3 4.4 14.3 11.6 0 3.2-3 5.5-7.4 5.5-3.8 0-6.6-1.8-7.4-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <path
        d="M18.6 12.2c-.5-.9-1.5-1.4-2.8-1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  );
}

/**
 * Logo complet : monogramme et nom sur deux lignes, comme la barre latérale
 * de la maquette. `compact` ne garde que le monogramme, `inverse` le passe
 * en blanc pour les fonds marine.
 */
export function Logo({ compact = false, size = 30, inverse = false, className }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', inverse ? 'text-white' : 'text-content', className)}>
      <LogoMark size={size} />
      {!compact && (
        <span className="font-display text-[15px] font-semibold leading-[1.1] tracking-tight">
          SmartRoom
          <br />
          Manager
        </span>
      )}
    </span>
  );
}
