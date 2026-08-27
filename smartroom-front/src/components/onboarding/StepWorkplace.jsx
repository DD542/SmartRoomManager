import { Building2, CheckCircle2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Pill } from '../ui/Badge';
import { Skeleton } from '../ui/States';

const CAPACITIES = [
  { value: '2-4', label: '2-4 personnes' },
  { value: '5-10', label: '5-10 personnes' },
  { value: '10+', label: '10+ personnes' },
];

function BuildingCard({ building, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(building.id)}
      aria-pressed={selected}
      className={cn(
        'group relative overflow-hidden rounded-xl border p-3 text-left transition',
        selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      {/* La photo du bâtiment, déposée par l'administration. L'écran affichait
          une icône même quand elle existait : la donnée arrivait bien, elle
          n'était simplement pas lue. L'icône reste, pour un bâtiment sans
          photo — un cadre vide vaudrait moins qu'un symbole. */}
      {building.imageUrl ? (
        <img
          src={building.imageUrl}
          alt=""
          className="mb-3 h-20 w-full rounded-lg border border-line object-cover
                     transition duration-300 group-hover:brightness-110"
        />
      ) : (
        <span
          aria-hidden="true"
          className="mb-3 flex h-20 items-end justify-start rounded-lg border border-line bg-surface-raised p-2"
        >
          <Building2 size={20} className="text-content-faint" />
        </span>
      )}
      <span className="block text-sm font-medium text-content">{building.name}</span>
      <span className="mt-0.5 block text-xs text-content-muted">{building.campus}</span>
      {selected && (
        <CheckCircle2
          size={18}
          aria-hidden="true"
          className="absolute right-3 top-3 text-accent"
        />
      )}
    </button>
  );
}

/** U-00, étape 1 — bâtiment principal et capacité habituellement recherchée. */
export function StepWorkplace({ buildings, isLoading, value, onChange }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-content">Où travaillez-vous le plus souvent ?</h2>
      <p className="mt-1 text-sm text-content-muted">
        Le bâtiment choisi pèse dans le score de recommandation des salles.
      </p>

      {isLoading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-36" />
          ))}
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-3" role="group" aria-label="Bâtiment principal">
          {buildings.map((building) => (
            <BuildingCard
              key={building.id}
              building={building}
              selected={value.preferredBuildingId === building.id}
              onSelect={(id) => onChange({ preferredBuildingId: id })}
            />
          ))}
        </div>
      )}

      <fieldset className="mt-7">
        <legend className="text-xs font-medium uppercase tracking-wide text-content-muted">
          Capacité habituellement recherchée
        </legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {CAPACITIES.map((capacity) => (
            <Pill
              key={capacity.value}
              active={value.usualCapacity === capacity.value}
              onClick={() => onChange({ usualCapacity: capacity.value })}
            >
              {capacity.label}
            </Pill>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
