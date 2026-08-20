import { Repeat } from 'lucide-react';
import { cn } from '../../utils/cn';
import { WEEK_DAYS, addDays, toDate, toDateInput } from '../../utils/dates';
import { Card, CardHeader } from '../ui/Card';
import { Input } from '../ui/Form';
import { SegmentedControl } from '../ui/Tabs';

const FREQUENCIES = [
  { value: 'quotidienne', label: 'Quotidienne' },
  { value: 'hebdomadaire', label: 'Hebdomadaire' },
  { value: 'mensuelle', label: 'Mensuelle' },
];

/** U-14 — édition de la règle : fréquence, jours répétés, condition de fin. */
export function RecurrenceRuleForm({ rule, onChange, anchorDate }) {
  const toggleDay = (day) =>
    onChange({
      weekDays: rule.weekDays.includes(day)
        ? rule.weekDays.filter((value) => value !== day)
        : [...rule.weekDays, day],
    });

  return (
    <Card>
      <CardHeader title="Règle de récurrence" icon={Repeat} />
      <div className="flex flex-col gap-5 px-4 pb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-content-muted">Fréquence</p>
          <SegmentedControl
            label="Fréquence"
            className="mt-2 w-full"
            options={FREQUENCIES}
            value={rule.frequency}
            onChange={(frequency) => onChange({ frequency })}
          />
        </div>

        {rule.frequency === 'hebdomadaire' && (
          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wide text-content-muted">
              Répéter le
            </legend>
            <div className="mt-2 flex gap-1.5">
              {WEEK_DAYS.map((day) => {
                const active = rule.weekDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    aria-pressed={active}
                    aria-label={day.label}
                    onClick={() => toggleDay(day.value)}
                    className={cn(
                      'h-8 w-8 rounded-full border text-xs transition',
                      active
                        ? 'border-accent bg-accent text-white'
                        : 'border-line bg-surface text-content-muted hover:text-content',
                    )}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-3">
          <legend className="text-xs font-medium uppercase tracking-wide text-content-muted">
            Se termine
          </legend>

          <label className="flex items-center gap-2 text-sm text-content">
            <input
              type="radio"
              name="fin"
              checked={rule.end.type === 'count'}
              onChange={() => onChange({ end: { type: 'count', value: 12 } })}
              className="h-4 w-4 accent-accent"
            />
            Après
            <input
              type="number"
              min={1}
              max={60}
              value={rule.end.type === 'count' ? rule.end.value : 12}
              disabled={rule.end.type !== 'count'}
              onChange={(event) => onChange({ end: { type: 'count', value: Number(event.target.value) } })}
              aria-label="Nombre d’occurrences"
              className="h-8 w-16 rounded-lg border border-line bg-surface-raised px-2 text-center font-mono text-xs text-content disabled:opacity-50"
            />
            occurrences
          </label>

          <label className="flex items-center gap-2 text-sm text-content">
            <input
              type="radio"
              name="fin"
              checked={rule.end.type === 'until'}
              onChange={() =>
                onChange({ end: { type: 'until', value: toDateInput(addDays(toDate(anchorDate), 90)) } })
              }
              className="h-4 w-4 accent-accent"
            />
            Le
            <Input
              type="date"
              aria-label="Date de fin"
              disabled={rule.end.type !== 'until'}
              value={rule.end.type === 'until' ? rule.end.value : ''}
              onChange={(event) => onChange({ end: { type: 'until', value: event.target.value } })}
              className="h-8"
            />
          </label>
        </fieldset>
      </div>
    </Card>
  );
}
