import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Accessibility, KeyRound, Map, Users, Zap } from 'lucide-react';
import { getRoom } from '../../api/rooms';
import { getNextFreeSlot } from '../../api/availability';
import { getPlanDocument, planIdForRoom } from '../../api/buildings';
import { useAsync } from '../../hooks/useAsync';
import { useAdminSession } from '../../hooks/useAdminSession';
import { useAuth } from '../../hooks/useAuth';
import { NOW, fmtTime, toDateInput } from '../../utils/dates';
import { fmtArea, fmtCapacity, ROOM_STATUS_LABEL } from '../../utils/format';
import { visitDaysLabel } from '../../utils/openingRules';
import { Badge, OccupancyBar } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { AsyncBoundary, Skeleton } from '../../components/ui/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { RoomGallery } from '../../components/rooms/RoomGallery';
import { RoomBookingPanel } from '../../components/rooms/RoomBookingPanel';
import { PlanPreview } from '../../components/rooms/PlanPreview';
import { PlanUpload } from '../../components/rooms/PlanUpload';
import { equipmentIcon } from '../../components/rooms/equipmentIcons';

const STATUS_TONE = { disponible: 'success', occupee: 'danger', maintenance: 'warning' };

/** U-17 — Fiche détaillée d'une salle. */
export default function RoomDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { permissions } = useAdminSession();
  const room = useAsync(() => getRoom(id), [id]);
  const nextSlot = useAsync(() => getNextFreeSlot(id, NOW), [id]);
  // Le plan n'est demandé que si l'étage en porte un. Sans cette condition,
  // chaque ouverture de fiche produisait un `404 /floors/…/plan` en rouge dans
  // la console — une réponse parfaitement juste, l'étage n'ayant pas de plan,
  // mais qui se lit comme une panne. `getPlanDocumentForPlan` prévoyait déjà
  // ce cas ; quatre écrans s'en servaient, celui-ci non, faute d'avoir
  // l'information dans sa charge utile.
  //
  // La dépendance porte sur `room.data` : `planIdForRoom` lit une table
  // alimentée par la fiche, et l'appeler avant elle rendrait `null`.
  const planDocument = useAsync(
    () =>
      getPlanDocument(id, { exists: Boolean(room.data?.floorHasPlan) }),
    [id, room.data?.floorHasPlan],
  );

  // Le dépôt du plan est une opération d'administration, gouvernée par la
  // permission `rooms.manage` — la même que côté back. Elle s'appuyait
  // auparavant sur `user.role === 'gestionnaire'` : aucune source ne produit
  // cette valeur (l'adaptateur ne rend que `etudiant` ou `personnel`), et la
  // zone d'import était donc invisible pour tout le monde.
  const canManage = permissions.includes('rooms.manage');
  const planId = planIdForRoom(id);

  // Deux documents répondent à « où est cette salle ? », et l'écran n'en
  // montrait qu'un. Le plan d'étage, déposé par l'administration, situe la
  // salle parmi les autres — c'est le plus riche, il reste prioritaire. Le
  // repère de la salle, lui, accompagne chaque fiche du parc.
  //
  // Sans ce recours, une salle qui avait son repère affichait « Aucun plan
  // déposé pour cet étage » : la donnée existait, l'API la rendait, et seuls
  // les écrans d'administration s'en servaient.
  const repere = room.data?.locationPlanUrl
    ? {
        id: `repere-${room.data.id}`,
        type: 'image',
        name: `Repère de ${room.data.name}`,
        url: room.data.locationPlanUrl,
      }
    : null;
  const planAffiche = planDocument.data ?? repere;

  useEffect(() => {
    if (room.data) document.title = `${room.data.name} — SmartRoom Manager`;
  }, [room.data]);

  const data = room.data;

  const book = () => {
    const slot = nextSlot.data;
    navigate('/app/reservation/besoin', {
      state: {
        draft: {
          buildingId: data.buildingId,
          attendees: Math.min(data.capacity, 4),
          date: slot ? toDateInput(slot.start) : toDateInput(NOW),
          startTime: slot ? fmtTime(slot.start) : '09:00',
          endTime: slot ? fmtTime(slot.end) : '10:00',
        },
      },
    });
  };

  return (
    <AsyncBoundary
      status={room.status}
      error={room.error}
      onRetry={room.reload}
      skeleton={<Skeleton className="h-96 w-full" />}
    >
      {data && (
        <div className="flex flex-col gap-5">
          <PageHeader
            title={data.name}
            backTo="/app/salles"
            backLabel="Retour à la liste des salles"
            actions={
              <Badge tone={STATUS_TONE[data.status] ?? 'default'} dot>
                {ROOM_STATUS_LABEL[data.status]}
              </Badge>
            }
          />

          <RoomGallery photos={data.photos} roomName={data.name} />

          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
            <div className="flex flex-col gap-4">
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="default" icon={Users}>
                    {fmtCapacity(data.capacity)}
                  </Badge>
                  <Badge tone="default">{fmtArea(data.area)}</Badge>
                  <Badge tone="default">
                    {data.building?.name} — {data.floor}
                  </Badge>
                  {data.accessible && (
                    <Badge tone="success" icon={Accessibility}>
                      Accessible PMR
                    </Badge>
                  )}
                </div>
                <p className="mt-3 text-sm leading-relaxed text-content-muted">{data.description}</p>
                <OccupancyBar rate={data.occupancyRate} className="mt-4" label="Occupation hebdomadaire" />
              </Card>

              <Card>
                <CardHeader title="Équipements inclus" icon={Zap} />
                <ul className="grid gap-2 px-4 pb-4 sm:grid-cols-3 [&>*]:min-w-0">
                  {data.equipment.map((item) => {
                    const Icon = equipmentIcon(item.icon);
                    return (
                      <li
                        key={item.id}
                        className="flex flex-col items-center gap-1.5 rounded-xl border border-line bg-surface-raised px-3 py-3 text-center"
                      >
                        <Icon size={16} aria-hidden="true" className="text-content-muted" />
                        <span className="text-xs text-content">{item.label}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>

              <Card>
                <CardHeader
                  title="Plan de localisation"
                  icon={Map}
                  subtitle={
                    canManage
                      ? 'Document déposé par l’administration : image ou PDF.'
                      : undefined
                  }
                />
                <div className="flex flex-col gap-3 px-4 pb-4">
                  <PlanPreview
                    document={planAffiche}
                    isLoading={planDocument.isLoading || room.isLoading}
                    actionLabel="Ouvrir le plan en grand"
                  />
                  {canManage && planId && (
                    <PlanUpload
                      planId={planId}
                      document={planDocument.data}
                      onUploaded={(uploaded) => planDocument.setData(uploaded)}
                    />
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader title="Conditions d’accès" icon={KeyRound} />
                <div className="grid gap-2 px-4 pb-4 sm:grid-cols-3 [&>*]:min-w-0">
                  <div className="rounded-xl border border-line bg-surface-raised p-3">
                    <p className="text-xs uppercase tracking-wide text-content-muted">Accès</p>
                    <p className="mt-1 text-xs text-content">
                      {data.badgeRequired ? 'Badge d’accès requis' : 'Code d’accès seul'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-line bg-surface-raised p-3">
                    <p className="text-xs uppercase tracking-wide text-content-muted">Jours</p>
                    <p className="mt-1 text-xs text-content">{visitDaysLabel(data.rules.visitDays)}</p>
                  </div>
                  <div className="rounded-xl border border-line bg-surface-raised p-3">
                    <p className="text-xs uppercase tracking-wide text-content-muted">Horaires</p>
                    <p className="mt-1 font-mono text-xs text-content">
                      {data.rules.openTime} - {data.rules.closeTime}
                    </p>
                  </div>
                </div>
                {data.rules.notice && (
                  <p className="mx-4 mb-3 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2 text-xs leading-relaxed text-content">
                    {data.rules.notice}
                  </p>
                )}
                <ul className="flex flex-col gap-1.5 px-4 pb-4">
                  {data.rules.constraints.map((constraint) => (
                    <li key={constraint} className="text-xs text-content-muted">
                      • {constraint}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <RoomBookingPanel room={data} nextSlot={nextSlot} onBook={book} />
          </div>
        </div>
      )}
    </AsyncBoundary>
  );
}
