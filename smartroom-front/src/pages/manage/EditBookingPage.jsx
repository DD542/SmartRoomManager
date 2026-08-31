import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Info, Save } from 'lucide-react';
import { getBooking, updateBooking } from '../../api/bookings';
import { listRooms } from '../../api/rooms';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../hooks/useToast';
import { fmtTime, mergeDateAndTime, toDateInput } from '../../utils/dates';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, Callout } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Form';
import { AsyncBoundary, Skeleton } from '../../components/ui/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { ParticipantInput } from '../../components/bookings/ParticipantInput';
import { ChangeSummary } from '../../components/bookings/ChangeSummary';

const timeInput =
  'h-10 w-full rounded-xl border border-line bg-surface-raised px-3 font-mono text-sm text-content focus:border-accent focus:outline-none';

/** U-10 — Modifier une réservation. Tout changement de créneau ou de salle
 * régénère le code d'accès, ce que l'écran annonce avant l'enregistrement. */
export default function EditBookingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const booking = useAsync(() => getBooking(id), [id]);
  const rooms = useAsync(listRooms, []);

  useEffect(() => {
    document.title = 'Modifier la réservation — SmartRoom Manager';
    if (booking.data && !form) {
      setForm({
        roomId: booking.data.roomId,
        roomName: booking.data.room?.name,
        date: toDateInput(booking.data.start),
        startTime: fmtTime(booking.data.start),
        endTime: fmtTime(booking.data.end),
        attendees: booking.data.attendees,
        title: booking.data.title,
        participants: booking.data.participants.filter((p) => !p.organizer),
      });
    }
  }, [booking.data, form]);

  const set = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateBooking(id, {
        roomId: form.roomId,
        title: form.title,
        attendees: Number(form.attendees),
        start: mergeDateAndTime(form.date, form.startTime),
        end: mergeDateAndTime(form.date, form.endTime),
        participants: [
          ...booking.data.participants.filter((p) => p.organizer),
          ...form.participants,
        ],
      });
      toast.success('Réservation modifiée', `Nouveau code d’accès : ${updated.accessCode}.`);
      navigate(`/app/reservations/${id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AsyncBoundary
      status={booking.status}
      error={booking.error}
      onRetry={booking.reload}
      skeleton={<Skeleton className="h-96 w-full" />}
    >
      {booking.data && form && (
        <div className="flex flex-col gap-5">
          <PageHeader
            title="Modifier la réservation"
            backTo={`/app/reservations/${id}`}
            backLabel="Retour au détail"
          />

          <Callout tone="accent" icon={Info}>
            La modification de l’horaire ou de la salle entraîne la génération d’un nouveau code
            d’accès, envoyé à tous les participants.
          </Callout>

          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
            <Card>
              <CardHeader title="Détails de la réservation" />
              <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2 [&>*]:min-w-0">
                <Input
                  label="Date"
                  type="date"
                  value={form.date}
                  onChange={(event) => set({ date: event.target.value })}
                />
                <Field label="Plage horaire">
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      aria-label="Heure de début"
                      value={form.startTime}
                      onChange={(event) => set({ startTime: event.target.value })}
                      className={timeInput}
                    />
                    <span aria-hidden="true" className="text-content-muted">–</span>
                    <input
                      type="time"
                      aria-label="Heure de fin"
                      value={form.endTime}
                      onChange={(event) => set({ endTime: event.target.value })}
                      className={timeInput}
                    />
                  </div>
                </Field>
                <Input
                  label="Capacité"
                  type="number"
                  min={1}
                  max={50}
                  value={form.attendees}
                  onChange={(event) => set({ attendees: event.target.value })}
                />
                <Select
                  label="Salle"
                  value={form.roomId}
                  onChange={(event) => {
                    const room = (rooms.data ?? []).find((r) => r.id === event.target.value);
                    set({ roomId: event.target.value, roomName: room?.name });
                  }}
                  options={(rooms.data ?? []).map((room) => ({
                    value: room.id,
                    label: `${room.name} — ${room.capacity} pers.`,
                  }))}
                />
                <Input
                  label="Objet de la réunion"
                  className="sm:col-span-2"
                  value={form.title}
                  onChange={(event) => set({ title: event.target.value })}
                />
                <div className="sm:col-span-2">
                  <ParticipantInput
                    label="Participants"
                    participants={form.participants}
                    onChange={(participants) => set({ participants })}
                  />
                </div>
                {error && (
                  <div className="sm:col-span-2">
                    <Callout tone="danger" title="Modification refusée">
                      {error}
                    </Callout>
                  </div>
                )}
              </div>
            </Card>

            <ChangeSummary
              before={{
                roomName: booking.data.room?.name,
                date: toDateInput(booking.data.start),
                startTime: fmtTime(booking.data.start),
                endTime: fmtTime(booking.data.end),
                attendees: booking.data.attendees,
              }}
              after={{
                roomName: form.roomName,
                date: form.date,
                startTime: form.startTime,
                endTime: form.endTime,
                attendees: form.attendees,
              }}
            />
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <Button variant="ghost" to={`/app/reservations/${id}`}>
              Abandonner
            </Button>
            <Button icon={Save} loading={saving} onClick={save}>
              Enregistrer les modifications
            </Button>
          </footer>
        </div>
      )}
    </AsyncBoundary>
  );
}
