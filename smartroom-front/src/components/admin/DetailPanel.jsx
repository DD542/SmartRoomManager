import { X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Card, CardHeader } from '../ui/Card';
import { IconButton } from '../ui/Button';
import { EmptyState } from '../ui/States';

/**
 * Rail droit des écrans de liste : détail de la ligne sélectionnée.
 * Sur mobile, la page le rend en pleine largeur sous la liste plutôt qu'en
 * colonne, faute de place pour deux volets côte à côte.
 */
export function DetailPanel({
  title,
  subtitle,
  icon,
  onClose,
  emptyIcon,
  emptyTitle = 'Aucune sélection',
  emptyDescription = 'Choisissez une ligne pour afficher son détail.',
  className,
  children,
}) {
  if (!children) {
    return (
      <Card className={cn('lg:sticky lg:top-4', className)}>
        <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
      </Card>
    );
  }

  return (
    <Card className={cn('flex flex-col lg:sticky lg:top-4', className)}>
      <CardHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        action={onClose && <IconButton icon={X} label="Fermer le détail" onClick={onClose} />}
      />
      <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
    </Card>
  );
}

/** Ligne d'information d'un panneau de détail : libellé à gauche, valeur à droite. */
export function DetailRow({ label, children, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-2 last:border-0">
      <span className="text-xs text-content-muted">{label}</span>
      <span className={cn('text-right text-sm text-content', mono && 'font-mono text-xs')}>
        {children}
      </span>
    </div>
  );
}
