import { useState } from 'react';
import { CalendarPlus, ShieldOff } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Checkbox, Input, Select } from '../../ui/Form';
import { useSlotCheck } from '../../../hooks/useSlotCheck';
import { SlotVerdict } from './SlotVerdict';
import { SegmentedControl } from '../../ui/Tabs';
import { mergeDateAndTime, toDateInput, NOW } from '../../../utils/dates';

const MODES = [
  { value: 'reservation', label: 'Pour un utilisateur' },
  { value: 'blocage', label: 'Blocage de salle' },
];

const INITIAL = {
  roomId: '',
  ownerId: '',
  title: '',
  attendees: 4,
  date: toDateInput(NOW),
  startTime: '14:00',
  endTime: '15:00',
  reason: '',
  ignoreRules: false,
};

/**
 * A-03 — création par l'administration : réservation au nom d'un utilisateur,
 * ou blocage de salle.
 *
 * Le créneau est vérifié pendant la saisie par le même moteur que le tunnel
 * utilisateur. « Ignorer les règles » ne lève que les règles d'ouverture et la
 * capacité : un chevauchement reste bloquant, la case ne le débloque jamais.
 */
export function AdminBookingModal({ open, onClose, onSubmit, rooms = [], users = [], loading = false }) {
  const [mode, setMode] = useState('reservation');
  const [form, setForm] = useState(INITIAL);

  const modifier = (patch) => setForm((current) => ({ ...current, ...patch }));
  const blocage = mode === 'blocage';

  const debut = form.date && form.startTime ? mergeDateAndTime(form.date, form.startTime) : null;
  const fin = form.date && form.endTime ? mergeDateAndTime(form.date, form.endTime) : null;
  const creneauValide = Boolean(debut && fin && fin > debut);

  const { verdict, verification } = useSlotCheck({
    actif: open && creneauValide,
    roomId: form.roomId,
    start: creneauValide ? debut.toISOString() : null,
    end: creneauValide ? fin.toISOString() : null,
    attendees: blocage ? 0 : Number(form.attendees) || 1,
  });

  const manquant = blocage
    ? !form.roomId || !form.reason.trim() || !creneauValide
    : !form.roomId || !form.ownerId || !creneauValide;
  const bloque = verdict?.blocking ?? false;

  const envoyer = () =>
    onSubmit({
      mode,
      payload: blocage
        ? {
            roomId: form.roomId,
            start: debut.toISOString(),
            end: fin.toISOString(),
            reason: form.reason,
          }
        : {
            roomId: form.roomId,
            ownerId: form.ownerId,
            title: form.title,
            attendees: Number(form.attendees) || 1,
            start: debut.toISOString(),
            end: fin.toISOString(),
            ignoreRules: form.ignoreRules,
          },
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={blocage ? ShieldOff : CalendarPlus}
      tone="accent"
      size="lg"
      title={blocage ? 'Bloquer une salle' : 'Créer une réservation'}
      description={
        blocage
          ? 'La salle devient indisponible sur le créneau, sans organisateur.'
          : 'La réservation est créée au nom de l’utilisateur choisi.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={loading} disabled={manquant || bloque} onClick={envoyer}>
            {blocage ? 'Bloquer la salle' : 'Créer la réservation'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl label="Type de création" options={MODES} value={mode} onChange={setMode} />

        <Select
          label="Salle"
          required
          placeholder="Choisir une salle"
          options={rooms}
          value={form.roomId}
          onChange={(event) => modifier({ roomId: event.target.value })}
        />

        <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
          <Input
            type="date"
            label="Date"
            required
            value={form.date}
            onChange={(event) => modifier({ date: event.target.value })}
          />
          <Input
            type="time"
            label="Début"
            required
            step={900}
            value={form.startTime}
            onChange={(event) => modifier({ startTime: event.target.value })}
          />
          <Input
            type="time"
            label="Fin"
            required
            step={900}
            value={form.endTime}
            error={debut && fin && fin <= debut ? 'La fin doit suivre le début.' : undefined}
            onChange={(event) => modifier({ endTime: event.target.value })}
          />
        </div>

        {blocage ? (
          <Input
            label="Motif du blocage"
            required
            placeholder="Travaux électriques, examen, événement…"
            value={form.reason}
            onChange={(event) => modifier({ reason: event.target.value })}
          />
        ) : (
          <>
            <Select
              label="Au nom de"
              required
              placeholder="Choisir un utilisateur"
              options={users}
              value={form.ownerId}
              onChange={(event) => modifier({ ownerId: event.target.value })}
            />
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Input
                label="Objet"
                placeholder="Réunion administrative"
                value={form.title}
                onChange={(event) => modifier({ title: event.target.value })}
              />
              <Input
                type="number"
                min={1}
                label="Participants"
                value={form.attendees}
                onChange={(event) => modifier({ attendees: event.target.value })}
              />
            </div>
            <Checkbox
              label="Ignorer les règles de réservation"
              description="Lève les règles d’ouverture, de durée et de capacité. Ne lève jamais un conflit."
              checked={form.ignoreRules}
              onChange={() => modifier({ ignoreRules: !form.ignoreRules })}
            />
          </>
        )}

        <SlotVerdict
          verdict={verdict}
          verification={verification}
          ignore={form.ignoreRules && !blocage}
        />
      </div>
    </Modal>
  );
}
