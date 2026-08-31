import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, CheckCircle2, DoorOpen, ListChecks, Monitor, Users } from 'lucide-react';
import { createBooking } from '../../api/bookings';
import { getDirections } from '../../api/buildings';
import { useAsync } from '../../hooks/useAsync';
import { getRoomRules } from '../../api/rooms';
import { ConsigneSalle } from '../../components/bookings/ConsigneSalle';
import { useAuth } from '../../hooks/useAuth';
import { useBooking } from '../../hooks/useBooking';
import { useToast } from '../../hooks/useToast';
import { fmtDateLong, mergeDateAndTime } from '../../utils/dates';
import { plural } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, Callout } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Form';
import { PageHeader } from '../../components/layout/PageHeader';
import { ParticipantInput } from '../../components/bookings/ParticipantInput';
import { AccessAside } from '../../components/bookings/AccessAside';

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex gap-3 border-b border-line px-4 py-3 last:border-0">
      <Icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-content-muted" />
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-content-muted">{label}</p>
        <div className="mt-0.5 text-sm text-content">{children}</div>
      </div>
    </div>
  );
}

/**
 * U-05 — Récapitulatif et confirmation, étape 4 du tunnel.
 * L'écriture passe par createBooking, qui revalide règles et conflits :
 * un créneau pris entre-temps est refusé ici avec un message explicite.
 */
export default function SummaryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { draft, update, hasDraft, hasRoom } = useBooking();
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = 'Récapitulatif — SmartRoom Manager';
  }, []);

  const directions = useAsync(
    () => (draft.roomId ? getDirections(draft.roomId) : Promise.resolve(null)),
    [draft.roomId],
  );

  // La consigne est relue ici plutôt que reprise du brouillon : celui-ci porte
  // la salle choisie à l'étape précédente, et une consigne écrite entre-temps
  // par l'administration n'y serait pas. C'est le dernier écran avant
  // l'écriture — c'est là qu'elle doit être juste.
  const regles = useAsync(
    () => (draft.roomId ? getRoomRules(draft.roomId) : Promise.resolve(null)),
    [draft.roomId],
  );

  if (!hasDraft || !hasRoom) return <Navigate to="/app/reservation/besoin" replace />;

  const start = mergeDateAndTime(draft.date, draft.startTime);
  const end = mergeDateAndTime(draft.date, draft.endTime);
  const equipment = draft.room?.equipment?.filter((item) => draft.equipmentIds.includes(item.id)) ?? [];

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const booking = await createBooking({
        roomId: draft.roomId,
        ownerId: user.id,
        title: draft.title,
        start,
        end,
        attendees: Number(draft.attendees),
        requiredEquipmentIds: draft.equipmentIds,
        // Les invités seulement : le serveur inscrit l'organisateur lui-même,
        // à partir de la session. L'envoyer ici le posait deux fois, et la
        // contrainte d'unicité refusait la réservation entière — « Cette
        // valeur est déjà utilisée », après quatre étapes de tunnel.
        participants: draft.participants,
      });
      toast.success('Réservation confirmée', `${booking.room.name}, code ${booking.accessCode}.`);
      // Le code en clair voyage par l'état de navigation, et nulle part
      // ailleurs : il n'existe qu'à cet instant, et l'écran de confirmation
      // est le dernier endroit où il peut être lu.
      navigate(`/app/reservation/${booking.id}/confirmee`, {
        replace: true,
        state: { code: booking.accessCode },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Dernière étape"
        subtitle="Vérifiez les détails de votre réservation avant de confirmer."
      />

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          {/* Avant le récapitulatif : ce qu'on doit savoir se lit avant de
              confirmer, pas après avoir cliqué. */}
          <ConsigneSalle notice={regles.data?.notice} />

          <Card>
            <CardHeader title="Récapitulatif de la réservation" icon={ListChecks} />
            <div>
              <Row icon={DoorOpen} label="Salle">
                {draft.room?.name} ({draft.room?.building?.name} — {draft.room?.floor})
              </Row>
              <Row icon={CalendarDays} label="Date & heure">
                <span className="capitalize">{fmtDateLong(start)}</span>
                <span className="ml-2 font-mono text-accent">
                  {draft.startTime} - {draft.endTime}
                </span>
              </Row>
              <Row icon={Users} label="Participants">
                {plural(Number(draft.attendees), 'personne')}
                {draft.participants.length > 0 && (
                  <span className="ml-2 text-xs text-content-muted">
                    dont {plural(draft.participants.length, 'invité')}
                  </span>
                )}
              </Row>
              <Row icon={Monitor} label="Équipements">
                {equipment.length === 0 ? (
                  <span className="text-content-faint">Aucun imposé</span>
                ) : (
                  equipment.map((item) => item.label).join(', ')
                )}
              </Row>
              <Row icon={ListChecks} label="Objet">
                {draft.title?.trim() || <span className="text-content-faint">Réunion</span>}
              </Row>
            </div>
          </Card>

          <Card>
            <CardHeader title="Inviter des participants" icon={Users} />
            <div className="flex flex-col gap-4 px-4 pb-4">
              <ParticipantInput
                participants={draft.participants}
                onChange={(participants) => update({ participants })}
              />
              <fieldset className="flex flex-col gap-2 border-t border-line pt-4">
                <legend className="text-xs font-medium uppercase tracking-wide text-content-muted">
                  Notifications
                </legend>
                <Checkbox
                  label="M’envoyer un e-mail de confirmation"
                  checked={draft.notifyConfirmation}
                  onChange={(checked) => update({ notifyConfirmation: checked })}
                />
                <Checkbox
                  label={`Me rappeler ${user.preferences?.reminderDelayMin ?? 30} minutes avant`}
                  checked={draft.notifyReminder}
                  onChange={(checked) => update({ notifyReminder: checked })}
                />
              </fieldset>
            </div>
          </Card>

          {error && <Callout tone="danger" title="Confirmation impossible">{error}</Callout>}
        </div>

        <AccessAside room={draft.room} steps={directions.data?.steps ?? []} />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Button variant="secondary" icon={ArrowLeft} to={`/app/reservation/salles/${draft.roomId}`}>
          Modifier ma recherche
        </Button>
        <Button size="lg" icon={CheckCircle2} loading={saving} onClick={confirm}>
          Confirmer la réservation
        </Button>
      </footer>
    </div>
  );
}
