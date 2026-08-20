import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, Check, Clock, DoorOpen, MapPin, X } from 'lucide-react';
import { getBooking, respondToInvitation } from '../../api/bookings';
import { useAsync } from '../../hooks/useAsync';
import { fmtDateLong, fmtTime } from '../../utils/dates';
import { PARTICIPANT_STATUS_LABEL } from '../../utils/format';
import { Avatar, AvatarGroup } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, Callout } from '../../components/ui/Card';
import { Textarea } from '../../components/ui/Form';
import { AsyncBoundary, Skeleton } from '../../components/ui/States';

const TONE = { accepte: 'success', en_attente: 'warning', decline: 'danger' };

/**
 * U-15 — Invitation à une réservation.
 * Page publique atteinte par un lien signé : le jeton porte l'identifiant de la
 * réservation, l'adresse de l'invité arrive en paramètre de requête.
 */
export default function InvitationPage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const email = params.get('email') ?? 'marie.laurent@entreprise.com';
  const [comment, setComment] = useState('');
  const [answer, setAnswer] = useState(null);
  const [pending, setPending] = useState(null);

  const booking = useAsync(() => getBooking(token), [token]);

  useEffect(() => {
    document.title = 'Invitation — SmartRoom Manager';
  }, []);

  const respond = async (response) => {
    setPending(response);
    try {
      await respondToInvitation(token, { email, response });
      setAnswer(response);
      booking.reload();
    } finally {
      setPending(null);
    }
  };

  const data = booking.data;
  const organizer = data?.participants.find((participant) => participant.organizer);
  const counts = (data?.participants ?? []).reduce(
    (acc, participant) => ({ ...acc, [participant.status]: (acc[participant.status] ?? 0) + 1 }),
    {},
  );

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <AsyncBoundary
        status={booking.status}
        error={booking.error}
        onRetry={booking.reload}
        skeleton={<Skeleton className="h-96 w-full" />}
      >
        {data && (
          <Card className="overflow-hidden">
            <header className="flex items-center gap-3 border-b border-line px-4 py-4">
              <Avatar name={organizer?.name ?? 'Organisateur'} size="lg" />
              <div>
                <h1 className="text-base font-semibold text-content">
                  {organizer?.name ?? 'Un organisateur'} vous invite
                </h1>
                <p className="text-xs text-content-muted">Invitation à une réunion</p>
              </div>
            </header>

            <div className="flex flex-col gap-4 px-4 py-4">
              <div>
                <h2 className="text-sm font-semibold text-content">{data.title}</h2>
                <div className="mt-2 flex flex-col gap-1.5 text-xs text-content-muted">
                  <p className="flex items-center gap-2">
                    <DoorOpen size={13} aria-hidden="true" />
                    Lieu : <span className="text-content">{data.room?.name}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <MapPin size={13} aria-hidden="true" />
                    {data.room?.building?.name} — {data.room?.floor} étage
                  </p>
                  <p className="flex items-center gap-2">
                    <CalendarDays size={13} aria-hidden="true" />
                    <span className="capitalize text-content">{fmtDateLong(data.start)}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Clock size={13} aria-hidden="true" />
                    <span className="font-mono text-content">
                      {fmtTime(data.start)} - {fmtTime(data.end)}
                    </span>
                  </p>
                </div>
              </div>

              <div className="border-t border-line pt-4">
                <p className="text-xs uppercase tracking-wide text-content-muted">
                  Participants ({data.participants.length})
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <AvatarGroup people={data.participants} max={5} />
                  {Object.entries(counts).map(([status, count]) => (
                    <Badge key={status} tone={TONE[status] ?? 'default'} dot>
                      {count} {PARTICIPANT_STATUS_LABEL[status]?.toLowerCase()}
                    </Badge>
                  ))}
                </div>
              </div>

              {answer ? (
                <Callout tone={answer === 'accepte' ? 'success' : 'warning'} icon={Check}>
                  Réponse enregistrée : {PARTICIPANT_STATUS_LABEL[answer].toLowerCase()}. L’organisateur
                  en est informé.
                </Callout>
              ) : (
                <Textarea
                  label="Ajouter un commentaire (optionnel)"
                  rows={3}
                  placeholder="Votre message pour l’organisateur…"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
              )}
            </div>

            {!answer && (
              <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
                <Button
                  variant="ghost"
                  icon={X}
                  loading={pending === 'decline'}
                  onClick={() => respond('decline')}
                >
                  Décliner
                </Button>
                <Button variant="secondary" to="/app/reservation/besoin">
                  Proposer un autre créneau
                </Button>
                <Button icon={Check} loading={pending === 'accepte'} onClick={() => respond('accepte')}>
                  Accepter
                </Button>
              </footer>
            )}
          </Card>
        )}
      </AsyncBoundary>
    </div>
  );
}
