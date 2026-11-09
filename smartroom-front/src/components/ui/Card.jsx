import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';

/** Surface de base : verre dépoli, bordure 1px, relief porté par `shadow-carte`. */
export function Card({ as: Tag = 'section', className, children, tone, ...props }) {
  return (
    <Tag
      className={cn(
        'rounded-2xl border bg-surface/75 shadow-carte backdrop-blur-xl',
        tone === 'danger' && 'border-danger/40',
        tone === 'warning' && 'border-warning/40',
        tone === 'accent' && 'border-accent/30',
        !tone && 'border-line/70',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

/**
 * En-tête de carte : titre, sous-titre, action à droite.
 *
 * `flex-wrap` et non une seule ligne : dans une carte de téléphone, le titre
 * et son action se disputaient 288 px. L'action, faute de pouvoir descendre,
 * se rétrécissait jusqu'à ce que son libellé s'écrive sur trois lignes —
 * « Nouvelle demande d'aide » sortait alors de son bouton par le haut et par
 * le bas. Elle passe désormais à la ligne, entière et lisible.
 */
export function CardHeader({ title, subtitle, icon: Icon, action, className }) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3 px-5 py-4', className)}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {Icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-content/[0.06] text-content">
            <Icon size={16} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 self-center">
          <h2 className="text-[15px] font-semibold tracking-tight text-content">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-content-muted">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function CardBody({ className, children }) {
  return <div className={cn('px-5 pb-5', className)}>{children}</div>;
}

export function CardFooter({ className, children }) {
  return (
    <footer className={cn('flex items-center justify-between gap-3 border-t border-line px-4 py-3', className)}>
      {children}
    </footer>
  );
}

/** Titre de section avec lien « Voir tout » à droite, motif récurrent des maquettes. */
export function SectionTitle({ title, icon: Icon, to, linkLabel = 'Voir tout', className, children }) {
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-content">
        {Icon && <Icon size={18} aria-hidden="true" className="text-content" />}
        {title}
      </h2>
      {children}
      {to && (
        <Link
          to={to}
          className="group inline-flex items-center gap-1 text-sm font-medium text-content transition hover:opacity-70"
        >
          {linkLabel}
          <span aria-hidden="true" className="transition-transform duration-300 ease-ressort group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      )}
    </div>
  );
}

/** Bandeau d'information contextuel (info, alerte, danger, succès). */
export function Callout({ tone = 'info', title, children, icon: Icon, action, className }) {
  const tones = {
    info: 'border-line bg-surface-raised text-content-muted',
    accent: 'border-accent/40 bg-accent-soft text-content',
    warning: 'border-warning/40 bg-warning-soft text-content',
    danger: 'border-danger/40 bg-danger-soft text-content',
    success: 'border-success/40 bg-success-soft text-content',
  };
  const iconTone = {
    info: 'text-content-muted',
    accent: 'text-content',
    warning: 'text-warning',
    danger: 'text-danger',
    success: 'text-success',
  };

  return (
    <div className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3', tones[tone], className)}>
      {Icon && <Icon size={16} aria-hidden="true" className={cn('mt-0.5 shrink-0', iconTone[tone])} />}
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        {title && <p className="text-sm font-medium text-content">{title}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}
