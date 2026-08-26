import { Building2, DoorOpen, Layers } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { plural } from '../../../utils/format';

/**
 * Un bâtiment dans la liste du parc.
 *
 * L'image tient la moitié de la carte parce que c'est elle qu'on reconnaît :
 * « Eiffel 3 » ne dit rien à qui traverse le campus, la façade si. À défaut,
 * une icône tient sa place plutôt que de laisser un cadre vide.
 */
export function BuildingCard({ building, active = false, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(building)}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full gap-3 rounded-xl border p-2.5 text-left transition',
        active
          ? 'border-accent bg-accent-soft'
          : 'border-line bg-surface-raised hover:border-line-strong',
      )}
    >
      {building.imageUrl ? (
        <img
          src={building.imageUrl}
          alt=""
          className="h-16 w-20 shrink-0 rounded-lg border border-line object-cover"
        />
      ) : (
        <span className="flex h-16 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-line">
          <Building2 size={18} aria-hidden="true" className="text-content-faint" />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm text-content">{building.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-content-muted">
            {building.code}
          </span>
        </span>
        {building.address && (
          <span className="mt-0.5 block truncate text-[11px] text-content-faint">
            {building.address}
          </span>
        )}
        <span className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-content-muted">
          <span className="inline-flex items-center gap-1">
            <Layers size={11} aria-hidden="true" />
            {plural(building.floorCount, 'étage')}
          </span>
          <span className="inline-flex items-center gap-1">
            <DoorOpen size={11} aria-hidden="true" />
            {plural(building.roomCount, 'salle')}
          </span>
        </span>
      </span>
    </button>
  );
}
