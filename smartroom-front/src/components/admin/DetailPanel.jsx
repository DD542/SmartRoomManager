import { X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Card, CardHeader } from '../ui/Card';
import { IconButton } from '../ui/Button';
import { BottomSheet } from '../ui/Modal';
import { EmptyState } from '../ui/States';

/**
 * Rail droit des écrans de liste : détail de la ligne sélectionnée.
 *
 * Au bureau, une colonne collante à droite de la liste. Sous 1024 px, la
 * grille se défaisait et le panneau tombait **sous** la liste : ouvrir une
 * ligne ne changeait rien à l'écran, il fallait deviner qu'une réponse était
 * apparue plus bas, y descendre, puis remonter pour choisir la suivante. Sur
 * une liste de trente comptes, cela fait trente allers-retours.
 *
 * Il s'ouvre donc en feuille inférieure — surface décidée, avec piège de
 * focus, fermeture par Échap et retour du focus à la ligne d'où l'on vient.
 * Le vide, lui, ne s'ouvre pas : une feuille annonçant « aucune sélection »
 * serait une fenêtre pour ne rien dire.
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
  const enColonne = useMediaQuery('(min-width: 1024px)');

  if (!enColonne) {
    return (
      <BottomSheet open={Boolean(children)} onClose={onClose} title={title ?? emptyTitle}>
        <div className="flex flex-col gap-3 pb-[env(safe-area-inset-bottom)]">
          {subtitle && <p className="text-xs text-content-muted">{subtitle}</p>}
          {children}
        </div>
      </BottomSheet>
    );
  }

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
