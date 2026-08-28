import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import {
  getDirections,
  getFloorPlan,
  getPlanDocumentForPlan,
  listFloorPlans,
} from '../../api/buildings';
import { listBookings } from '../../api/bookings';
import { useAsync } from '../../hooks/useAsync';
import { useAdminSession } from '../../hooks/useAdminSession';
import { useAuth } from '../../hooks/useAuth';
import { NOW, fmtDate, isSameDay, toDate } from '../../utils/dates';
import { Card, CardHeader } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/Tabs';
import { AsyncBoundary, Skeleton } from '../../components/ui/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { FloorPlan, FloorPlanLegend } from '../../components/rooms/FloorPlan';
import { PdfPlanView } from '../../components/rooms/PdfPlanView';
import { PlanUpload } from '../../components/rooms/PlanUpload';
import { RoomPlanAside } from '../../components/rooms/RoomPlanAside';
import { FloorRoomPicker, RoomLocationPlan } from '../../components/rooms/RoomLocationPlan';

/** U-18 — Plan de localisation du bâtiment, avec panneau de détail de la salle. */
export default function FloorPlanPage() {
  const { user } = useAuth();
  const { permissions } = useAdminSession();
  // Aucun étage au départ, et surtout pas `plan-a` : cet identifiant venait des
  // maquettes. L'API le refusait — « L'étage doit être un identifiant valide » —
  // et l'écran s'ouvrait sur une erreur avant même que la liste soit chargée.
  // Le premier étage réel est choisi dès que la liste arrive.
  const [planId, setPlanId] = useState(null);
  const [selected, setSelected] = useState(null);

  // Le dépôt du plan est une opération d'administration.
  // Le dépôt du plan est une opération d'administration, gouvernée par la
  // permission `rooms.manage` — la même que côté back. Elle s'appuyait
  // auparavant sur `user.role === 'gestionnaire'` : aucune source ne produit
  // cette valeur (l'adaptateur ne rend que `etudiant` ou `personnel`), et la
  // zone d'import était donc invisible pour tout le monde.
  const canManage = permissions.includes('rooms.manage');

  useEffect(() => {
    document.title = 'Plan du bâtiment — SmartRoom Manager';
  }, []);

  const plans = useAsync(listFloorPlans, []);

  // Le premier étage de la liste, une fois qu'elle est là. Sans étage, les deux
  // chargements ci-dessous ne partent pas : demander un plan sans identifiant
  // ne peut produire qu'un refus.
  useEffect(() => {
    if (planId === null && plans.data?.length) setPlanId(plans.data[0].id);
  }, [planId, plans.data]);

  const plan = useAsync(
    () => (planId ? getFloorPlan(planId) : Promise.resolve(null)),
    [planId],
  );
  const planDocument = useAsync(
    () => (planId ? getPlanDocumentForPlan(planId) : Promise.resolve(null)),
    [planId],
  );
  const myBookings = useAsync(() => listBookings({ ownerId: user.id, status: 'confirmee' }), [user.id]);
  const directions = useAsync(
    () => (selected ? getDirections(selected.id) : Promise.resolve(null)),
    [selected?.id],
  );

  const mineIds = (myBookings.data ?? [])
    .filter((booking) => isSameDay(toDate(booking.start), NOW))
    .map((booking) => booking.roomId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plan de localisation"
        subtitle="Repérez les salles libres et l’itinéraire depuis l’entrée."
        actions={
          <SegmentedControl
            label="Étage affiché"
            value={planId}
            onChange={(value) => {
              setPlanId(value);
              setSelected(null);
            }}
            options={(plans.data ?? []).map((item) => ({ value: item.id, label: item.label }))}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <AsyncBoundary
          status={plan.status}
          error={plan.error}
          onRetry={plan.reload}
          skeleton={<Skeleton className="h-[28rem] w-full" />}
        >
          {plan.data && (
            <div className="flex flex-col gap-3">
              {/* Le plan déposé pour la salle choisie l'emporte sur le schéma :
                  c'est l'image que montre déjà l'administration, et la seule
                  qui situe vraiment la salle dans le bâtiment. */}
              <RoomLocationPlan room={selected} onBack={() => setSelected(null)}>
                {planDocument.data?.type === 'pdf' ? (
                  <PdfPlanView
                    document={planDocument.data}
                    rooms={plan.data.rooms}
                    mineIds={mineIds}
                    selectedId={selected?.id}
                    onSelect={setSelected}
                  />
                ) : (
                  <FloorPlan
                    plan={plan.data}
                    rooms={plan.data.rooms}
                    mineIds={mineIds}
                    selectedId={selected?.id}
                    onSelect={setSelected}
                    document={planDocument.data}
                  />
                )}
              </RoomLocationPlan>

              <FloorRoomPicker
                rooms={plan.data.rooms}
                selectedId={selected?.id}
                onSelect={setSelected}
              />

              {plan.data.unplaced > 0 && (
                <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-content">
                  {plan.data.unplaced} salle{plan.data.unplaced > 1 ? 's' : ''} de cet étage
                  {plan.data.unplaced > 1 ? ' ne sont pas encore posées' : ' n’est pas encore posée'}
                  {' '}sur le plan : elle{plan.data.unplaced > 1 ? 's' : ''} reste
                  {plan.data.unplaced > 1 ? 'nt' : ''} réservable
                  {plan.data.unplaced > 1 ? 's' : ''} depuis le catalogue.
                </p>
              )}

              <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <FloorPlanLegend legend={plan.data.legend} />
                <p className="text-[11px] text-content-faint">
                  {planDocument.isLoading
                    ? 'Chargement du plan…'
                    : planDocument.data
                      ? `Plan officiel : ${planDocument.data.name} — déposé le ${fmtDate(planDocument.data.updatedAt)}`
                      : 'Aucun plan déposé pour ce bâtiment : schéma indicatif.'}
                </p>
              </Card>

              {canManage && (
                <Card>
                  <CardHeader
                    title="Plan du bâtiment"
                    icon={Upload}
                    subtitle="Déposez le plan officiel : il remplacera le schéma pour tous les utilisateurs."
                  />
                  <div className="px-4 pb-4">
                    <PlanUpload
                      planId={planId}
                      document={planDocument.data}
                      onUploaded={(uploaded) => planDocument.setData(uploaded)}
                    />
                  </div>
                </Card>
              )}
            </div>
          )}
        </AsyncBoundary>

        <RoomPlanAside
          room={selected}
          directions={directions.data?.steps ?? []}
          onClose={() => setSelected(null)}
        />
      </div>
    </div>
  );
}
