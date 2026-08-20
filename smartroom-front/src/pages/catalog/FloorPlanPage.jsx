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

/** U-18 — Plan de localisation du bâtiment, avec panneau de détail de la salle. */
export default function FloorPlanPage() {
  const { user } = useAuth();
  const [planId, setPlanId] = useState('plan-a');
  const [selected, setSelected] = useState(null);

  // Le dépôt du plan est une opération d'administration.
  const canManage = user.role === 'gestionnaire';

  useEffect(() => {
    document.title = 'Plan du bâtiment — SmartRoom Manager';
  }, []);

  const plans = useAsync(listFloorPlans, []);
  const plan = useAsync(() => getFloorPlan(planId), [planId]);
  const planDocument = useAsync(() => getPlanDocumentForPlan(planId), [planId]);
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
