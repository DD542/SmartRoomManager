import { useEffect, useState } from 'react';
import {
  getDirections,
  getFloorPlan,
  getPlanDocumentForPlan,
  listFloorPlans,
} from '../../api/buildings';
import { listBookings } from '../../api/bookings';
import { useAsync } from '../../hooks/useAsync';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useAuth } from '../../hooks/useAuth';
import { NOW, fmtDate, isSameDay, toDate } from '../../utils/dates';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Form';
import { BottomSheet } from '../../components/ui/Modal';
import { AsyncBoundary, Skeleton } from '../../components/ui/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { FloorPlan, FloorPlanLegend } from '../../components/rooms/FloorPlan';
import { PdfPlanView } from '../../components/rooms/PdfPlanView';
import { RoomPlanAside } from '../../components/rooms/RoomPlanAside';
import { FloorRoomPicker, RoomLocationPlan } from '../../components/rooms/RoomLocationPlan';

/** U-18 — Plan de localisation du bâtiment, avec panneau de détail de la salle. */
export default function FloorPlanPage() {
  const { user } = useAuth();
  // Aucun étage au départ, et surtout pas `plan-a` : cet identifiant venait des
  // maquettes. L'API le refusait — « L'étage doit être un identifiant valide » —
  // et l'écran s'ouvrait sur une erreur avant même que la liste soit chargée.
  // Le premier étage réel est choisi dès que la liste arrive.
  const isMobile = useIsMobile();
  const [planId, setPlanId] = useState(null);
  const [selected, setSelected] = useState(null);

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
  // `exists` évite la requête quand la liste dit déjà qu'aucun plan n'est
  // déposé : la réponse serait un 404 légitime, que la console affiche en
  // rouge et qu'on lit comme une panne.
  const etageChoisi = (plans.data ?? []).find((item) => item.id === planId);
  const planDocument = useAsync(
    () =>
      planId
        ? getPlanDocumentForPlan(planId, { exists: Boolean(etageChoisi?.hasPlan) })
        : Promise.resolve(null),
    [planId, etageChoisi?.hasPlan],
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
          // Une liste déroulante et non un contrôle segmenté : le parc compte
          // treize étages, et treize onglets « Eiffel 3 — 1er étage » alignés
          // débordaient de l'écran à toutes les largeurs sous 1280 px. Un
          // contrôle segmenté vaut pour deux à cinq choix ; au-delà, c'est une
          // liste.
          <Select
            label="Étage affiché"
            value={planId ?? ''}
            onChange={(event) => {
              setPlanId(event.target.value);
              setSelected(null);
            }}
            options={(plans.data ?? []).map((item) => ({ value: item.id, label: item.label }))}
            className="min-w-[14rem]"
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
              {/* Sous 768 px, la liste des salles passe avant le plan : on
                  choisit une salle pour obtenir son itinéraire, et chercher
                  d'abord un rectangle au doigt dans un schéma de 100 unités
                  n'est pas un geste de téléphone. */}
              <div className="order-first md:order-none">
                <p className="mb-2 text-xs text-content-muted md:hidden">
                  {selected
                    ? `Itinéraire vers ${selected.name} ci-dessous.`
                    : 'Choisissez une salle pour afficher son plan et son itinéraire.'}
                </p>
                <FloorRoomPicker
                  rooms={plan.data.rooms}
                  selectedId={selected?.id}
                  onSelect={setSelected}
                />
              </div>

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
            </div>
          )}
        </AsyncBoundary>

        {/* Au bureau, le détail occupe la colonne de droite. Au téléphone, il
            s'ouvre en feuille : posé sous le plan, il tombait après la liste,
            la légende et l'encart des salles non posées — hors de l'écran. */}
        {isMobile ? (
          <BottomSheet
            open={Boolean(selected)}
            onClose={() => setSelected(null)}
            title={selected?.name ?? 'Salle'}
          >
            <RoomPlanAside
              room={selected}
              directions={directions.data?.steps ?? []}
              onClose={() => setSelected(null)}
            />
          </BottomSheet>
        ) : (
          <RoomPlanAside
            room={selected}
            directions={directions.data?.steps ?? []}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
