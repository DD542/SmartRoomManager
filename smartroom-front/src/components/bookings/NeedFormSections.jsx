import { Accessibility, CalendarDays, MapPin, Minus, Monitor, Plus, Repeat, Users } from 'lucide-react';
import { fmtDuration } from '../../utils/dates';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Field, Input, Select, Switch } from '../ui/Form';
import { ToggleChip } from '../ui/Badge';

const timeInput =
  'h-10 w-full rounded-xl border border-line bg-surface-raised px-3 font-mono text-sm text-content focus:border-accent focus:outline-none';

/** U-02, bloc 1 — bâtiment, date, créneau. */
export function WhereWhenSection({ draft, update, buildings, minutes }) {
  return (
    <Card>
      <CardHeader title="Où & quand" icon={MapPin} />
      <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Select
          label="Bâtiment privilégié"
          className="sm:col-span-2"
          value={draft.buildingId}
          onChange={(event) => update({ buildingId: event.target.value })}
          options={buildings.map((b) => ({ value: b.id, label: `${b.name} — ${b.campus}` }))}
          placeholder="Tous les bâtiments"
        />
        <Input
          label="Date de la réunion"
          type="date"
          icon={CalendarDays}
          required
          value={draft.date}
          onChange={(event) => update({ date: event.target.value })}
        />
        <Field label="Créneau" hint={minutes > 0 ? `Durée : ${fmtDuration(minutes)}` : undefined}>
          <div className="flex items-center gap-2">
            <input
              type="time"
              aria-label="Heure de début"
              value={draft.startTime}
              onChange={(event) => update({ startTime: event.target.value })}
              className={timeInput}
            />
            <span aria-hidden="true" className="text-content-muted">
              –
            </span>
            <input
              type="time"
              aria-label="Heure de fin"
              value={draft.endTime}
              onChange={(event) => update({ endTime: event.target.value })}
              className={timeInput}
            />
          </div>
        </Field>
      </div>
    </Card>
  );
}

/** U-02, bloc 2 — effectif et objet de la réunion. */
export function ConfigurationSection({ draft, update }) {
  const bump = (delta) =>
    update({ attendees: Math.min(50, Math.max(1, Number(draft.attendees) + delta)) });

  return (
    <Card>
      <CardHeader title="Configuration" icon={Users} />
      <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Field label="Capacité (personnes)" htmlFor="capacite" required>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" aria-label="Retirer une personne" onClick={() => bump(-1)}>
              <Minus size={15} aria-hidden="true" />
            </Button>
            <input
              id="capacite"
              type="number"
              min={1}
              max={50}
              required
              value={draft.attendees}
              onChange={(event) => update({ attendees: event.target.value })}
              className="h-10 w-full rounded-xl border border-line bg-surface-raised px-3 text-center font-mono text-sm text-content focus:border-accent focus:outline-none"
            />
            <Button variant="secondary" size="icon" aria-label="Ajouter une personne" onClick={() => bump(1)}>
              <Plus size={15} aria-hidden="true" />
            </Button>
          </div>
        </Field>
        <Input
          label="Objet de la réunion"
          placeholder="Revue de sprint, atelier, entretien…"
          value={draft.title}
          onChange={(event) => update({ title: event.target.value })}
        />
      </div>
    </Card>
  );
}

/** U-02, bloc 3 — équipements requis, accessibilité, récurrence. */
export function EquipmentSection({ draft, update, equipment }) {
  const toggle = (id) =>
    update({
      equipmentIds: draft.equipmentIds.includes(id)
        ? draft.equipmentIds.filter((item) => item !== id)
        : [...draft.equipmentIds, id],
    });

  return (
    <Card>
      <CardHeader title="Équipements & options" icon={Monitor} />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <fieldset>
          <legend className="text-xs font-medium uppercase tracking-wide text-content-muted">
            Équipements requis
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {equipment.map((item) => (
              <ToggleChip
                key={item.id}
                label={item.label}
                active={draft.equipmentIds.includes(item.id)}
                onClick={() => toggle(item.id)}
              />
            ))}
          </div>
        </fieldset>

        <div className="h-px bg-line" aria-hidden="true" />

        <Switch
          icon={Accessibility}
          label="Salle accessible PMR"
          description="Filtrer uniquement les salles de plain-pied ou desservies par un ascenseur."
          checked={draft.accessible}
          onChange={(checked) => update({ accessible: checked })}
        />
        <Switch
          icon={Repeat}
          label="Réunion récurrente"
          description="Réserver ce créneau pour plusieurs occurrences."
          checked={draft.recurring}
          onChange={(checked) => update({ recurring: checked })}
        />
      </div>
    </Card>
  );
}
