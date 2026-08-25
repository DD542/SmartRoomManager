import { CalendarDays } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Input } from '../../ui/Form';
import { SegmentedControl } from '../../ui/Tabs';
import { ToggleChip } from '../../ui/Badge';

// La valeur est celle qui transite sur le réseau : l'API n'accepte que
// `day`, `week` et `month`. Le français vit dans le libellé, et nulle part
// ailleurs — un état de composant en français obligerait à traduire à chaque
// appel, donc à oublier de le faire une fois.
const GRANULARITES = [
  { value: 'day', label: 'Par jour' },
  { value: 'month', label: 'Par mois' },
];

/**
 * A-02 — sélection de la période, des bâtiments et du pas d'agrégation.
 *
 * Les bornes sont deux champs date natifs : le clavier, la saisie au format
 * local et le sélecteur du système restent ceux que l'utilisateur connaît.
 */
export function ReportFilters({ value, onChange, buildings = [], presets = [], className }) {
  const modifier = (patch) => onChange({ ...value, ...patch });

  const basculerBatiment = (id) =>
    modifier({
      buildingIds: value.buildingIds.includes(id)
        ? value.buildingIds.filter((item) => item !== id)
        : [...value.buildingIds, id],
    });

  return (
    <Card className={className}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            type="date"
            label="Du"
            icon={CalendarDays}
            value={value.from}
            max={value.to}
            onChange={(event) => modifier({ from: event.target.value })}
            className="w-[168px]"
          />
          <Input
            type="date"
            label="Au"
            icon={CalendarDays}
            value={value.to}
            min={value.from}
            onChange={(event) => modifier({ to: event.target.value })}
            className="w-[168px]"
          />

          <div className="flex flex-wrap items-center gap-1.5 pb-1">
            {presets.map((preset) => (
              <ToggleChip
                key={preset.label}
                label={preset.label}
                active={value.from === preset.from && value.to === preset.to}
                onClick={() => modifier({ from: preset.from, to: preset.to })}
              />
            ))}
          </div>

          <div className="ml-auto pb-1">
            <SegmentedControl
              label="Pas d’agrégation"
              options={GRANULARITES}
              value={value.granularity}
              onChange={(granularity) => modifier({ granularity })}
            />
          </div>
        </div>

        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Bâtiments inclus dans le rapport</legend>
          <span className="text-xs uppercase tracking-wide text-content-muted">Bâtiments</span>
          <ToggleChip
            label="Tous"
            active={value.buildingIds.length === 0}
            onClick={() => modifier({ buildingIds: [] })}
          />
          {buildings.map((batiment) => (
            <ToggleChip
              key={batiment.id}
              label={batiment.name}
              active={value.buildingIds.includes(batiment.id)}
              onClick={() => basculerBatiment(batiment.id)}
            />
          ))}
        </fieldset>
      </div>
    </Card>
  );
}
