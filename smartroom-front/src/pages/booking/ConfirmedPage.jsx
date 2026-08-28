import { useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { CalendarPlus, CheckCircle2, Map } from 'lucide-react';
import { getBooking } from '../../api/bookings';
import { getPlanDocumentForPlan } from '../../api/buildings';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { fmtDateLong, fmtTime } from '../../utils/dates';
import { downloadIcs } from '../../utils/ics';
import { AccessCode } from '../../components/ui/AccessCode';
import { PlanPreview } from '../../components/rooms/PlanPreview';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { AsyncBoundary, Skeleton } from '../../components/ui/States';

/**
 * U-06 — Réservation confirmée.
 * L'écran ne dépend plus du brouillon : il relit la réservation par son
 * identifiant, ce qui le rend partageable et rechargeable.
 */
export default function ConfirmedPage() {
  const { id } = useParams();
  const { state: etat } = useLocation();
  const { user } = useAuth();
  const toast = useToast();
  const booking = useAsync(() => getBooking(id), [id]);

  // Le plan de l'étage ne sert que de repli, et n'est demandé que s'il existe :
  // le réclamer à tout hasard valait un 404 par étage sans plan, rouge dans la
  // console, où il se lit comme une panne.
  const planDocument = useAsync(
    () =>
      booking.data?.room?.floorId
        ? getPlanDocumentForPlan(booking.data.room.floorId, {
            exists: Boolean(booking.data.room.floorHasPlan),
          })
        : Promise.resolve(null),
    [booking.data?.room?.floorId, booking.data?.room?.floorHasPlan],
  );

  // La salle porte le plus souvent son propre plan de localisation, déposé par
  // l'administration : c'est celui qui situe vraiment la salle, et l'écran
  // n'en montrait aucun.
  const planAffiche = booking.data?.room?.locationPlanUrl
    ? {
        type: 'image',
        url: booking.data.room.locationPlanUrl,
        name: `Plan de localisation — ${booking.data.room.name}`,
      }
    : planDocument.data;

  // Le code en clair, tel que la création vient de le rendre. Il n'existe qu'à
  // cet instant : la base n'en garde qu'une empreinte, et cet écran est le
  // seul endroit où il peut encore être lu. Rechargée ou partagée, la page
  // retombe sur l'indice.
  const codeEnClair = etat?.code ?? null;

  useEffect(() => {
    document.title = 'Réservation confirmée — SmartRoom Manager';
  }, []);

  return (
    <div className="mx-auto w-full max-w-lg">
      <AsyncBoundary
        status={booking.status}
        error={booking.error}
        onRetry={booking.reload}
        skeleton={<Skeleton className="h-96 w-full" />}
      >
        {booking.data && (
          <Card className="animate-scale-in p-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-success/40 bg-success-soft">
              <CheckCircle2 size={24} aria-hidden="true" className="text-success" />
            </span>

            <h1 className="mt-4 text-xl font-semibold text-content">Réservation confirmée !</h1>
            <p className="mt-1 text-xs text-content-muted">
              Un e-mail de confirmation a été envoyé à{' '}
              <span className="font-mono text-content">{user.email}</span>
            </p>

            <dl className="mt-5 divide-y divide-line rounded-xl border border-line bg-surface-raised text-left">
              <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                <dt className="text-xs text-content-muted">Salle</dt>
                <dd className="text-sm text-content">{booking.data.room?.name}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                <dt className="text-xs text-content-muted">Date</dt>
                <dd className="text-sm capitalize text-content">{fmtDateLong(booking.data.start)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                <dt className="text-xs text-content-muted">Heure</dt>
                <dd className="font-mono text-sm text-content">
                  {fmtTime(booking.data.start)} - {fmtTime(booking.data.end)}
                </dd>
              </div>
            </dl>

            {(codeEnClair || booking.data.accessCode) && (
              <div className="mt-4 rounded-xl border border-line bg-surface-raised px-4 py-3">
                <p className="text-xs text-content-muted">Code d’accès</p>
                <AccessCode
                  code={codeEnClair ?? booking.data.accessCode}
                  size="sm"
                  className="mt-1 justify-center"
                />
                <p className="mt-1.5 text-xs text-content-muted">
                  {codeEnClair
                    ? 'Notez-le : il n’est affiché qu’une fois.'
                    : 'Le code complet n’a été affiché qu’une fois. Émettez-en un nouveau depuis la réservation si vous l’avez perdu.'}
                </p>
              </div>
            )}

            <div className="mt-3 text-left">
              <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">
                Plan de localisation
              </p>
              <PlanPreview
                document={planAffiche}
                isLoading={planDocument.isLoading && !planAffiche}
                actionLabel="Ouvrir le plan"
              />
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <Button
                fullWidth
                icon={CalendarPlus}
                onClick={() => {
                  downloadIcs(booking.data);
                  toast.success('Fichier agenda généré', 'Ouvrez-le pour l’ajouter à votre calendrier.');
                }}
              >
                Ajouter à mon agenda
              </Button>
              <Button variant="secondary" fullWidth icon={Map} to="/app/plan">
                Voir le plan interactif
              </Button>
              <Button variant="ghost" size="sm" to="/app">
                Retour à l’accueil
              </Button>
            </div>
          </Card>
        )}
      </AsyncBoundary>
    </div>
  );
}
