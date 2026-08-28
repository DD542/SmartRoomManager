import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, History, MapPin, Pencil, Route, XCircle } from 'lucide-react';
import { getBooking, reissueAccessCode } from '../../api/bookings';
import { getPlanDocumentForPlan } from '../../api/buildings';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../hooks/useToast';
import { fmtDateLong, fmtTime, toDate } from '../../utils/dates';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Timeline } from '../../components/ui/Stepper';
import { AccessCodePanel } from '../../components/ui/AccessCode';
import { AsyncBoundary, Skeleton } from '../../components/ui/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { BookingStatusBadge } from '../../components/bookings/BookingTable';
import { ParticipantList } from '../../components/bookings/ParticipantList';
import { PlanPreview } from '../../components/rooms/PlanPreview';
import CancelBookingModal from './CancelBookingModal';

const HISTORY_TONE = {
  creee: 'default',
  confirmee: 'success',
  modifiee: 'accent',
  rappel_envoye: 'accent',
  checkin: 'success',
  annulee: 'danger',
};

/** U-09 — Détail d'une réservation, avec historique et zone dangereuse. */
export default function BookingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const booking = useAsync(() => getBooking(id), [id]);
  const [cancelOpen, setCancelOpen] = useState(params.get('annuler') === '1');
  // Le plan d'étage, demandé par l'identifiant que porte la réservation. Il ne
  // sert que de repli : la salle a le plus souvent son propre plan de
  // localisation, déposé par l'administration, qui montre exactement où elle
  // se trouve.
  const planDocument = useAsync(
    () =>
      booking.data?.room?.floorId
        ? getPlanDocumentForPlan(booking.data.room.floorId)
        : Promise.resolve(null),
    [booking.data?.room?.floorId],
  );

  // Le code en clair, quand l'utilisateur vient d'en demander un neuf. Il ne
  // vient jamais du chargement : le serveur ne le détient plus une fois émis.
  const [codeEnClair, setCodeEnClair] = useState(null);
  const [emission, setEmission] = useState(false);

  const reemettre = async () => {
    setEmission(true);
    try {
      const { code } = await reissueAccessCode(id);
      setCodeEnClair(code);
      toast.success('Nouveau code émis', 'Le précédent ne fonctionne plus.');
    } catch (souci) {
      toast.error('Émission refusée', souci.message);
    } finally {
      setEmission(false);
    }
  };

  const planAffiche = booking.data?.room?.locationPlanUrl
    ? {
        type: 'image',
        url: booking.data.room.locationPlanUrl,
        name: `Plan de localisation — ${booking.data.room.name}`,
      }
    : planDocument.data;

  useEffect(() => {
    if (booking.data) document.title = `${booking.data.title} — SmartRoom Manager`;
  }, [booking.data]);

  const data = booking.data;
  const active = data?.status === 'confirmee' || data?.status === 'en_attente';

  return (
    <div className="flex flex-col gap-5">
      <AsyncBoundary
        status={booking.status}
        error={booking.error}
        onRetry={booking.reload}
        skeleton={<Skeleton className="h-96 w-full" />}
      >
        {data && (
          <>
            <PageHeader
              title="Détail de la réservation"
              backTo="/app/reservations"
              backLabel="Retour à mes réservations"
              actions={<BookingStatusBadge status={data.status} />}
            />

            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <div className="flex flex-col gap-4">
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                    <div>
                      <h2 className="text-base font-semibold text-content">{data.room?.name}</h2>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-content-muted">
                        <MapPin size={12} aria-hidden="true" />
                        {data.room?.building?.name} — {data.room?.floor} étage
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="inline-flex rounded-lg border border-line bg-surface-raised px-2 py-1 font-mono text-sm text-content">
                        {fmtTime(data.start)} - {fmtTime(data.end)}
                      </p>
                      <p className="mt-1 text-xs capitalize text-content-muted">{fmtDateLong(data.start)}</p>
                    </div>
                  </div>

                  <div className="border-t border-line px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-content-muted">Objet de la réunion</p>
                    <p className="mt-1.5 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-content">
                      « {data.title} »
                    </p>
                  </div>

                  <div className="border-t border-line px-4 py-4">
                    <ParticipantList participants={data.participants} />
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Historique de la réservation" icon={History} />
                  <div className="px-4 pb-4">
                    <Timeline
                      items={data.history.map((event, index) => ({
                        id: `${event.type}-${index}`,
                        label: event.label,
                        at: `${fmtDateLong(event.at)} — ${fmtTime(event.at)}`,
                        tone: HISTORY_TONE[event.type],
                      }))}
                    />
                  </div>
                </Card>
              </div>

              <div className="flex flex-col gap-4">
                <Card>
                  {data.room?.badgeRequired ? (
                    <AccessCodePanel
                      code={codeEnClair}
                      hint={data.accessCode}
                      badgeRequired
                      canReissue={active}
                      onReissue={reemettre}
                      reissuing={emission}
                    />
                  ) : (
                    <div className="p-6 text-center text-xs text-content-muted">
                      Accès libre : cette salle ne demande pas de code à sa porte.
                    </div>
                  )}
                  <div className="border-t border-line px-4 py-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">
                      Localisation
                    </p>
                    <PlanPreview document={planAffiche} isLoading={planDocument.isLoading && !planAffiche} />
                    <Button
                      variant="ghost"
                      size="sm"
                      fullWidth
                      icon={Route}
                      className="mt-2"
                      to="/app/plan"
                    >
                      Voir le plan interactif
                    </Button>
                  </div>
                </Card>

                {active && (
                  <>
                    <Button icon={Pencil} to={`/app/reservations/${data.id}/modifier`}>
                      Modifier la réservation
                    </Button>
                    {toDate(data.start) <= new Date(Date.now() + 864e5) && (
                      <Button variant="secondary" icon={CheckCircle2} to={`/app/check-in/${data.id}`}>
                        Valider ma présence
                      </Button>
                    )}

                    <Card tone="danger" className="p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-danger">
                        Zone dangereuse
                      </p>
                      <Button
                        variant="danger"
                        size="sm"
                        fullWidth
                        icon={XCircle}
                        className="mt-2"
                        onClick={() => setCancelOpen(true)}
                      >
                        Annuler la réservation
                      </Button>
                    </Card>
                  </>
                )}
              </div>
            </div>

            <CancelBookingModal
              booking={data}
              open={cancelOpen}
              onClose={() => {
                setCancelOpen(false);
                if (params.get('annuler')) setParams({}, { replace: true });
              }}
              onCancelled={() => {
                booking.reload();
                navigate(`/app/reservations/${data.id}`, { replace: true });
              }}
            />
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
