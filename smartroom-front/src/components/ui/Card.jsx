import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';

/** Surface de base : bordure 1px, pas d'ombre, pas de dégradé. */
export function Card({ as: Tag = 'section', className, children, tone, ...props }) {
  return (
    <Tag
      className={cn(
        'rounded-xl border bg-surface',
        tone === 'danger' && 'border-danger/40',
        tone === 'warning' && 'border-warning/40',
        tone === 'accent' && 'border-accent/50',
        !tone && 'border-line',
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
    <header className={cn('flex flex-wrap items-start justify-between gap-3 px-4 py-3', className)}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {Icon && <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-content">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-content-muted">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function CardBody({ className, children }) {
  return <div className={cn('px-4 pb-4', className)}>{children}</div>;
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
      <h2 className="flex items-center gap-2 text-sm font-semibold text-content">
        {Icon && <Icon size={16} aria-hidden="true" className="text-accent" />}
        {title}
      </h2>
      {children}
      {to && (
        <Link to={to} className="text-xs font-medium text-accent transition hover:text-accent-hover">
          {linkLabel}
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
    accent: 'text-accent',
    warning: 'text-warning',
    danger: 'text-danger',
    success: 'text-success',
  };

  return (
    <div className={cn('flex items-start gap-3 rounded-xl border px-3.5 py-3', tones[tone], className)}>
      {Icon && <Icon size={16} aria-hidden="true" className={cn('mt-0.5 shrink-0', iconTone[tone])} />}
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        {title && <p className="text-sm font-medium text-content">{title}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}
