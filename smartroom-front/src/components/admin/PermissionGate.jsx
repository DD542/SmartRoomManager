import { Lock } from 'lucide-react';
import { usePermission } from '../../hooks/usePermission';
import { Tooltip } from '../ui/Tooltip';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/States';

/**
 * Masque ou neutralise une action selon la permission de la session.
 *
 * `mode="masquer"` retire l'élément, `mode="desactiver"` le laisse visible mais
 * inerte avec une infobulle : l'administrateur comprend qu'une action existe
 * sans pouvoir la déclencher, ce qui vaut mieux qu'une interface trompeuse.
 */
export function PermissionGate({ permission, mode = 'masquer', children }) {
  const { peut } = usePermission();
  if (peut(permission)) return children;
  if (mode === 'masquer') return null;

  return (
    <Tooltip label="Votre compte ne dispose pas de cette permission.">
      <span className="pointer-events-none inline-flex opacity-40" aria-disabled="true">
        {children}
      </span>
    </Tooltip>
  );
}

/** Écran complet affiché quand une route est refusée à la session. */
export function PermissionDenied({ permission }) {
  return (
    <Card>
      <EmptyState
        icon={Lock}
        title="Section réservée"
        description={`Votre compte ne dispose pas de la permission « ${permission} ». Demandez-la à un administrateur disposant de la configuration du système.`}
      />
    </Card>
  );
}
