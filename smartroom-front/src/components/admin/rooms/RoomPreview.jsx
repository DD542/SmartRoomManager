import { Eye } from 'lucide-react';
import { Card, CardHeader } from '../../ui/Card';
import { RoomCard } from '../../rooms/RoomCard';
import { WEEK_DAYS } from '../../../utils/dates';
import { fmtDuration } from '../../../utils/dates';

/**
 * A-06 — aperçu utilisateur en direct.
 *
 * Rend la carte réelle de l'espace utilisateur à partir du brouillon en cours :
 * ce n'est pas une imitation, c'est le composant que verront les utilisateurs.
 */
export function RoomPreview({ draft, buildings = [], catalog = [] }) {
  const batiment = buildings.find((item) => item.value === draft.buildingId);
  const regles = draft.rules ?? {};

  const salle = {
    ...draft,
    capacity: Number(draft.capacity) || 0,
    area: Number(draft.area) || 0,
    building: { name: batiment?.label ?? 'Bâtiment à choisir' },
    equipment: catalog.filter((item) => draft.equipmentIds.includes(item.id)),
    photos: draft.photos?.length > 0 ? draft.photos : [PLACEHOLDER],
    occupancyRate: draft.occupancyRate ?? 0,
  };

  const jours = (regles.visitDays ?? [])
    .map((valeur) => WEEK_DAYS.find((jour) => jour.value === valeur)?.short)
    .filter(Boolean)
    .join(' ');

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader
        title="Aperçu utilisateur"
        subtitle="La carte telle qu’elle apparaîtra à la recherche"
        icon={Eye}
      />
      <div className="flex flex-col gap-3 px-4 pb-4">
        {/* Le lien est neutralisé : cet aperçu ne doit pas quitter l'éditeur. */}
        <div className="pointer-events-none">
          <RoomCard room={salle} tight={false} to="#" />
        </div>

        <dl className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface-raised p-3 text-xs">
          <Ligne label="Ouverture">
            {jours || 'aucun jour'} · {regles.openTime ?? '—'} – {regles.closeTime ?? '—'}
          </Ligne>
          <Ligne label="Durée autorisée">
            {fmtDuration(regles.minDurationMin ?? 0)} à {fmtDuration(regles.maxDurationMin ?? 0)}
          </Ligne>
          <Ligne label="Battement">{regles.bufferMin ?? 0} min</Ligne>
          <Ligne label="Code d’accès">{draft.badgeRequired ? 'généré' : 'aucun'}</Ligne>
        </dl>
      </div>
    </Card>
  );
}

function Ligne({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-content-muted">{label}</dt>
      <dd className="text-right font-mono text-content">{children}</dd>
    </div>
  );
}

/** Visuel neutre tant qu'aucune photo n'a été déposée. */
const PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400">
    <rect width="640" height="400" fill="#1A2231"/>
    <rect x="150" y="130" width="340" height="140" rx="12" fill="none" stroke="#3B4A66" stroke-width="3" stroke-dasharray="10 8"/>
    <text x="320" y="210" fill="#8A97AC" font-family="monospace" font-size="20" text-anchor="middle">Aucun visuel</text>
  </svg>`,
)}`;
