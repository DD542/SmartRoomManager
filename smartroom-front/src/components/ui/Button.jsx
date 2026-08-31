import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

const VARIANTS = {
  primary: 'bg-accent text-ink hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface-raised text-content border border-line hover:border-line-strong',
  ghost: 'bg-transparent text-content-muted border border-transparent hover:bg-surface-raised hover:text-content',
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
  sm: 'min-h-8 px-3 py-1 text-xs gap-1.5',
  md: 'min-h-10 px-4 py-1.5 text-sm gap-2',
  lg: 'min-h-12 px-5 py-2 text-sm gap-2',
  // 36 px à l'œil, 44 px au doigt : la zone tactile est étendue par un
  // pseudo-élément plutôt qu'en grossissant le bouton, qui déformerait les
  // barres d'outils denses de l'administration. 44 px est le minimum
  // recommandé par WCAG 2.1 (2.5.5).
  icon: 'relative h-9 w-9 justify-center after:absolute after:-inset-1 after:content-[""]',
};

const base =
  // `text-center` : un libellé qui passe à la ligne se lit centré comme le
  // reste du bouton, et non aligné à gauche sous son icône.
  'inline-flex items-center justify-center rounded-xl text-center font-medium transition ' +
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
      {IconRight && !loading && <IconRight size={16} aria-hidden="true" />}
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
