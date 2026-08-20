import { Building2, Sparkles, Users } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync';
import { recommendBest } from '../../api/recommendations';
import { fmtCapacity } from '../../utils/format';
import { Card, Callout } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/States';

export const CAPACITY_TO_ATTENDEES = { '2-4': 4, '5-10': 8, '10+': 12 };

/**
 * U-00, étape 3 — récapitulatif, et première recommandation calculée avec les
 * préférences saisies : la promesse du produit est démontrée avant la fin.
 */
export function StepReady({ value, buildings }) {
  const attendees = CAPACITY_TO_ATTENDEES[value.usualCapacity] ?? 6;
  const building = buildings.find((b) => b.id === value.preferredBuildingId);

  const { data: suggestion, isLoading } = useAsync(
    () => recommendBest({ attendees, equipmentIds: [], buildingId: value.preferredBuildingId }),
    [attendees, value.preferredBuildingId],
  );

  return (
    <div>
      <h2 className="text-xl font-semibold text-content">Tout est prêt</h2>
      <p className="mt-1 text-sm text-content-muted">
        Voici ce que nous retenons de vos préférences.
      </p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2">
        <Card className="flex items-center gap-3 p-4">
          <Building2 size={16} aria-hidden="true" className="text-accent" />
          <div>
            <dt className="text-xs uppercase tracking-wide text-content-muted">Bâtiment principal</dt>
            <dd className="text-sm text-content">{building?.name ?? 'Non renseigné'}</dd>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <Users size={16} aria-hidden="true" className="text-accent" />
          <div>
            <dt className="text-xs uppercase tracking-wide text-content-muted">Capacité habituelle</dt>
            <dd className="text-sm text-content">{value.usualCapacity} personnes</dd>
          </div>
        </Card>
      </dl>

      <div className="mt-4">
        {isLoading && <Skeleton className="h-24 w-full" />}

        {!isLoading && suggestion && (
          <Card tone="accent" className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-accent">
                <Sparkles size={13} aria-hidden="true" />
                Votre première recommandation
              </p>
              <Badge tone="accent">{suggestion.score} / 100</Badge>
            </div>
            <p className="mt-2 text-sm font-semibold text-content">{suggestion.room.name}</p>
            <p className="text-xs text-content-muted">
              {suggestion.room.building?.name} • {suggestion.room.floor} •{' '}
              {fmtCapacity(suggestion.room.capacity)}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-content-muted">
              {suggestion.justification}
            </p>
          </Card>
        )}

        {!isLoading && !suggestion && (
          <Callout tone="warning">
            Aucune salle ne correspond encore à ces critères. Vous pourrez élargir la recherche depuis
            le catalogue.
          </Callout>
        )}
      </div>
    </div>
  );
}
