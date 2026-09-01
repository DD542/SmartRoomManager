import { RotateCcw } from 'lucide-react';
import { Card } from '../ui/Card';
import { Checkbox } from '../ui/Form';

/**
 * Rail de filtres du catalogue et de l'étape 2 du tunnel.
 * Sous 768px, la page le monte dans un BottomSheet plutôt que dans la colonne.
 */
export function RoomFilters({ value, onChange, buildings = [], equipment = [], floors = [], onReset }) {
  const toggle = (key, id) => {
    const current = value[key] ?? [];
    onChange({
      [key]: current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    });
  };

  return (
    <Card className="lg:sticky lg:top-4">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-sm font-semibold text-content">Filtres</h2>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 text-xs text-accent transition hover:text-accent-hover"
        >
          <RotateCcw size={12} aria-hidden="true" />
          Réinitialiser
        </button>
      </header>

      <div className="flex flex-col gap-5 px-4 pb-4">
        <fieldset>
          <legend className="text-xs font-medium uppercase tracking-wide text-content-muted">
            Capacité minimale
          </legend>
          <div className="mt-3 flex items-center gap-3">
            <input
              type="range"
              min={2}
              max={50}
              step={1}
              value={value.capacity}
              onChange={(event) => onChange({ capacity: Number(event.target.value) })}
              aria-label="Capacité minimale"
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-surface-raised accent-accent"
            />
            <span className="w-12 shrink-0 text-right font-mono text-sm text-content">
              {value.capacity}
            </span>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-medium uppercase tracking-wide text-content-muted">
            Bâtiment
          </legend>
          <div className="mt-3 flex flex-col gap-2">
            {buildings.map((building) => (
              <Checkbox
                key={building.id}
                label={building.name}
                checked={(value.buildings ?? []).includes(building.id)}
                onChange={() => toggle('buildings', building.id)}
              />
            ))}
          </div>
        </fieldset>

        {floors.length > 0 && (
          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wide text-content-muted">
              Étage
            </legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {/* L'étage se choisit par son identifiant, s'affiche par son
                  libellé : c'est l'identifiant que le serveur sait filtrer, et
                  deux bâtiments ont chacun leur « 1er étage ». */}
              {floors.map((floor) => {
                const active = (value.floors ?? []).includes(floor.id);
                return (
                  <button
                    key={floor.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle('floors', floor.id)}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                      active
                        ? 'border-accent bg-accent-soft text-content'
                        : 'border-line bg-surface text-content-muted hover:text-content'
                    }`}
                  >
                    {floor.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className="text-xs font-medium uppercase tracking-wide text-content-muted">
            Équipements
          </legend>
          <div className="mt-3 flex flex-col gap-2">
            {equipment.map((item) => (
              <Checkbox
                key={item.id}
                label={item.label}
                checked={(value.equipment ?? []).includes(item.id)}
                onChange={() => toggle('equipment', item.id)}
              />
            ))}
          </div>
        </fieldset>

        <div className="border-t border-line pt-4">
          <Checkbox
            label="Accessible PMR"
            checked={Boolean(value.accessible)}
            onChange={(checked) => onChange({ accessible: checked })}
          />
        </div>
      </div>
    </Card>
  );
}
