import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Minus, Plus, Search } from 'lucide-react';
import { NOW, toDateInput } from '../../utils/dates';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Field, Input } from '../ui/Form';

/**
 * U-01 — recherche rapide. Elle ne cherche pas elle-même : elle amorce le
 * tunnel en transmettant un brouillon par l'état de navigation, que U-02 reprend.
 */
export function QuickSearchCard({ defaultBuildingId }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    date: toDateInput(NOW),
    startTime: '09:00',
    endTime: '10:00',
    attendees: 4,
  });

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const bump = (delta) =>
    setForm((current) => ({ ...current, attendees: Math.max(1, Number(current.attendees) + delta) }));

  const onSubmit = (event) => {
    event.preventDefault();
    navigate('/app/reservation/besoin', {
      state: { draft: { ...form, attendees: Number(form.attendees), buildingId: defaultBuildingId } },
    });
  };

  return (
    <Card className="h-full">
      <CardHeader title="Recherche rapide" icon={Search} />
      <form onSubmit={onSubmit} className="flex flex-col gap-3 px-4 pb-4">
        <Input label="Date" type="date" value={form.date} onChange={set('date')} required />

        <Field label="Plage horaire">
          <div className="flex items-center gap-2">
            <input
              type="time"
              aria-label="Heure de début"
              value={form.startTime}
              onChange={set('startTime')}
              className="h-10 w-full rounded-xl border border-line bg-surface-raised px-3 font-mono text-sm text-content focus:border-accent focus:outline-none"
            />
            <span className="text-content-muted" aria-hidden="true">
              –
            </span>
            <input
              type="time"
              aria-label="Heure de fin"
              value={form.endTime}
              onChange={set('endTime')}
              className="h-10 w-full rounded-xl border border-line bg-surface-raised px-3 font-mono text-sm text-content focus:border-accent focus:outline-none"
            />
          </div>
        </Field>

        <Field label="Capacité minimale (personnes)" htmlFor="capacite-rapide">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => bump(-1)}
              aria-label="Retirer une personne"
            >
              <Minus size={15} aria-hidden="true" />
            </Button>
            <input
              id="capacite-rapide"
              type="number"
              min={1}
              max={50}
              value={form.attendees}
              onChange={set('attendees')}
              className="h-10 w-full rounded-xl border border-line bg-surface-raised px-3 text-center font-mono text-sm text-content focus:border-accent focus:outline-none"
            />
            <Button
              variant="secondary"
              size="icon"
              onClick={() => bump(1)}
              aria-label="Ajouter une personne"
            >
              <Plus size={15} aria-hidden="true" />
            </Button>
          </div>
        </Field>

        <Button type="submit" fullWidth iconRight={ArrowRight} className="mt-1">
          Rechercher
        </Button>
      </form>
    </Card>
  );
}
