import { Check, Plus } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { equipmentIcon } from '../../rooms/equipmentIcons';
import { Button } from '../../ui/Button';
import { plural } from '../../../utils/format';

/**
 * A-06 — onglet Équipements.
 *
 * Chaque équipement coché entre dans le score de recommandation de la salle :
 * la liste est donc celle du catalogue, jamais une saisie libre.
 */
export function EquipmentTab({ draft, onChange, catalog = [], categories = [] }) {
  const basculer = (id) =>
    onChange({
      equipmentIds: draft.equipmentIds.includes(id)
        ? draft.equipmentIds.filter((item) => item !== id)
        : [...draft.equipmentIds, id],
    });

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-content-muted">
        {plural(draft.equipmentIds.length, 'équipement sélectionné', 'équipements sélectionnés')} sur{' '}
        {catalog.length} au catalogue.
      </p>

      {categories.map((categorie) => {
        const items = catalog.filter((item) => item.category === categorie.id);
        if (items.length === 0) return null;
        return (
          <fieldset key={categorie.id}>
            <legend className="mb-2 text-xs uppercase tracking-wide text-content-muted">
              {categorie.label}
            </legend>
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((item) => {
                const actif = draft.equipmentIds.includes(item.id);
                const Icone = equipmentIcon(item.icon);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => basculer(item.id)}
                      aria-pressed={actif}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl border p-3 text-left transition',
                        actif
                          ? 'border-accent bg-accent-soft'
                          : 'border-line bg-surface-raised hover:border-line-strong',
                      )}
                    >
                      <Icone
                        size={16}
                        aria-hidden="true"
                        className={actif ? 'text-accent' : 'text-content-muted'}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-content">{item.label}</span>
                        {item.description && (
                          <span className="block truncate text-[11px] text-content-faint">
                            {item.description}
                          </span>
                        )}
                      </span>
                      {actif && <Check size={14} aria-hidden="true" className="text-accent" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}

      <p className="text-xs text-content-faint">
        Un équipement absent de cette liste doit d’abord être créé au catalogue.
      </p>
      <Button variant="secondary" size="sm" icon={Plus} to="/admin/equipements">
        Ouvrir le catalogue des équipements
      </Button>
    </div>
  );
}
