import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

const VARIANTS = {
  // Marine plein en thème clair, corail en sombre : la surface la plus dense
  // de l'écran, l'œil y va droit. Le bouton se soulève d'un pixel au survol et retombe sous le doigt : le
  // geste de la première version, gardé avec la pression à ressort.
  primary:
    'bg-accent text-ink hover:bg-accent-hover border border-transparent shadow-bouton ' +
    'hover:-translate-y-px hover:shadow-haute',
  // Corail, l'appel à l'action de MentorGoal. Le texte est marine et non
  // blanc : le blanc ne tient que 2,6:1 sur ce corail, le marine 7:1. La
  // flèche, elle, se pose dans une pastille blanche qui glisse au survol.
  corail:
    'group/corail bg-corail text-[#0C1547] border border-transparent font-semibold ' +
    'shadow-[0_12px_28px_-12px_rgb(255_128_83/0.85)] hover:-translate-y-px hover:brightness-105',
  // Contour net plutôt que verre : un bouton de verre posé sur une carte
  // blanche disparaissait (« Voir sur le plan », « Ouvrir le plan en grand »).
  // Le filet le détache dans les deux thèmes, le survol le teinte.
  secondary:
    'bg-surface text-content border border-line-strong shadow-sm ' +
    'hover:border-accent/50 hover:bg-accent-soft',
  // Fantôme posé sur la barre marine : blanc quel que soit le thème.
  'ghost-marine': 'bg-transparent text-white/80 border border-transparent hover:bg-white/10 hover:text-white',
  ghost: 'bg-transparent text-content-muted border border-transparent hover:bg-content/[0.06] hover:text-content',
  danger: 'bg-transparent text-danger border border-danger/40 hover:bg-danger/10',
  'danger-solid': 'bg-danger text-ink border border-transparent hover:brightness-110',
  success: 'bg-success text-ink border border-transparent hover:brightness-110',
};

//: `min-h` et non `h` : une hauteur fixe ne grandit pas quand le libellé passe
//: à la ligne. « Nouvelle demande d'aide » dans une colonne étroite s'écrivait
//: sur trois lignes dans un bouton haut de 40 px — le texte sortait par le
//: haut et par le bas, illisible, et rien n'indiquait où finissait le bouton.
//: La hauteur minimale garde les barres denses de l'administration alignées et
//: laisse le bouton s'étirer quand il le faut.
const SIZES = {
  sm: 'min-h-8 px-3.5 py-1 text-xs gap-1.5',
  md: 'min-h-10 px-5 py-1.5 text-sm gap-2',
  lg: 'min-h-12 px-6 py-2 text-[15px] gap-2',
  // 36 px à l'œil, 44 px au doigt : la zone tactile est étendue par un
  // pseudo-élément plutôt qu'en grossissant le bouton, qui déformerait les
  // barres d'outils denses de l'administration. 44 px est le minimum
  // recommandé par WCAG 2.1 (2.5.5).
  icon: 'relative h-9 w-9 justify-center after:absolute after:-inset-1 after:content-[""]',
};

const base =
  // `text-center` : un libellé qui passe à la ligne se lit centré comme le
  // reste du bouton, et non aligné à gauche sous son icône.
  // Pilule et pression à ressort : le bouton s'enfonce sous le doigt puis
  // rebondit, comme les contrôles d'iOS.
  'pression inline-flex items-center justify-center rounded-full text-center font-medium ' +
  'transition-[background-color,border-color,color,box-shadow,transform,scale] ' +
  'disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * Bouton unique du design system. `to` produit un lien de navigation, `href`
 * un lien externe, sinon un <button>. L'état `loading` reste accessible :
 * le libellé demeure lisible par les lecteurs d'écran.
 */
export const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    className,
    children,
    loading = false,
    disabled,
    icon: Icon,
    iconRight: IconRight,
    to,
    href,
    fullWidth = false,
    ...props
  },
  ref,
) {
  const classes = cn(
    base,
    VARIANTS[variant] ?? VARIANTS.primary,
    SIZES[size] ?? SIZES.md,
    fullWidth && 'w-full',
    className,
  );

  const content = (
    <>
      {loading ? (
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      ) : (
        Icon && <Icon size={16} aria-hidden="true" />
      )}
      {children}
      {IconRight && !loading &&
        (variant === 'corail' ? (
          <span className="-mr-2 ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#E8613A] transition-transform duration-500 ease-ressort group-hover/corail:translate-x-0.5">
            <IconRight size={16} aria-hidden="true" />
          </span>
        ) : (
          <IconRight size={16} aria-hidden="true" />
        ))}
    </>
  );

  if (to) {
    return (
      <Link ref={ref} to={to} className={classes} aria-busy={loading || undefined} {...props}>
        {content}
      </Link>
    );
  }

  if (href) {
    return (
      <a ref={ref} href={href} className={classes} {...props}>
        {content}
      </a>
    );
  }

  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {content}
    </button>
  );
});

/** Bouton carré réservé aux icônes : le libellé accessible est obligatoire. */
export const IconButton = forwardRef(function IconButton(
  { icon: Icon, label, variant = 'ghost', className, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size="icon"
      aria-label={label}
      title={label}
      className={cn('p-0', className)}
      {...props}
    >
      <Icon size={18} aria-hidden="true" />
    </Button>
  );
});
