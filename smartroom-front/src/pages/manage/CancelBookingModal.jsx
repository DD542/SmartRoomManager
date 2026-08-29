import { useState } from 'react';
import { AlertTriangle, CalendarDays, Clock, DoorOpen, Trash2, Users } from 'lucide-react';
import { cancelBooking, listCancelReasons } from '../../api/bookings';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../hooks/useToast';
import { fmtDateLong, fmtTime } from '../../utils/dates';
import { fmtCapacity } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Card';
import { Checkbox, Select, Textarea } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';

function Line({ icon: Icon, children }) {
  return (
    <p className="flex items-center gap-2 text-xs text-content-muted">
      <Icon size={13} aria-hidden="true" />
      {children}
    </p>
  );
}

/**
 * U-11 — Annulation d'une réservation.
 * Modale montée sur le détail (U-09) : le motif est obligatoire, l'API le
 * refuse sinon, et le créneau est libéré immédiatement.
 */
export default function CancelBookingModal({ booking, open, onClose, onCancelled }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const reasons = useAsync(listCancelReasons, []);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const updated = await cancelBooking(booking.id, { reason, comment, notifyParticipants: notify });
      toast.success('Réservation annulée', `${booking.room?.name} — créneau libéré.`);
      onCancelled?.(updated);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Annuler la réservation"
      icon={AlertTriangle}
      tone="danger"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Retour
          </Button>
          <Button variant="danger-solid" icon={Trash2} loading={pending} onClick={submit}>
            Confirmer l’annulation
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-line bg-surface-raised p-3">
          <p className="flex items-center gap-2 text-sm text-content">
            <DoorOpen size={14} aria-hidden="true" className="text-content-muted" />
            {booking.room?.name}
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            <Line icon={CalendarDays}>
              <span className="capitalize">{fmtDateLong(booking.start)}</span>
            </Line>
            <Line icon={Clock}>
              <span className="font-mono">
                {fmtTime(booking.start)} - {fmtTime(booking.end)}
              </span>
            </Line>
            <Line icon={Users}>{fmtCapacity(booking.attendees)}</Line>
          </div>
        </div>

        <Select
          label="Motif de l’annulation"
          required
          placeholder="Sélectionner un motif"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
          // Les motifs arrivent déjà sous la forme qu'attend `Select` :
          // `{ id, label }`. Les réemballer en `{ value: item, label: item }`
          // mettait l'objet entier dans les deux champs — React refuse un objet
          // comme enfant, et l'écran d'annulation tombait sur l'écran d'erreur
          // du routeur avant même d'être visible.
          options={reasons.data ?? []}
        />

        <Textarea
          label="Commentaire (optionnel)"
          rows={3}
          placeholder="Précisez la raison de l’annulation…"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />

        <Checkbox
          label="Prévenir les participants par e-mail"
          checked={notify}
          onChange={setNotify}
        />

        <Callout tone="info">
          Le créneau sera libéré immédiatement et la salle redeviendra réservable.
        </Callout>

        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Modal>
  );
}
