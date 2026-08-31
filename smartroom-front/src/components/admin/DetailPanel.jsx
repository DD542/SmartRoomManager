import { X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Card, CardHeader } from '../ui/Card';
import { IconButton } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { EmptyState } from '../ui/States';
import { useIsMobileOuTablette } from './PileInspecteur';

/**
 * Rail droit des écrans de liste : détail de la ligne sélectionnée.
 *
 * Sous 1024 px il n'y a plus de rail. Le détail tombait alors **sous** la
 * liste : choisir une réservation ne changeait rien à l'écran, il fallait
 * deviner qu'un panneau était apparu quinze lignes plus bas. Et quand rien
 * n'était choisi, c'est un encart « Aucune sélection » qui occupait la place.
 *
 * En dessous du seuil, le détail s'ouvre donc en boîte de dialogue par-dessus
 * la liste — celle-ci garde sa position —, et l'encart vide disparaît : il ne
 * dit rien qu'une liste sans surbrillance ne dise déjà.
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
  const enDialogue = useIsMobileOuTablette();

  if (enDialogue) {
    if (!children) return null;
    return (
      <Modal
        open
        onClose={onClose}
        title={title}
        description={subtitle}
        icon={icon}
        size="lg"
        footer={
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-line bg-surface-raised px-4 text-sm text-content transition hover:border-line-strong"
          >
            Fermer le détail
          </button>
        }
      >
        <div className="flex flex-col gap-3">{children}</div>
      </Modal>
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
