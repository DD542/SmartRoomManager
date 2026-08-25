import { AlertOctagon, CalendarClock, DoorOpen, ShieldCheck } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { Badge, Pill } from '../../ui/Badge';
import { fmtRelative } from '../../../utils/dates';

const TYPE_META = {
  conflit_double: { label: 'Double réservation', icon: AlertOctagon },
  conflit_materiel: { label: 'Équipement', icon: AlertOctagon },
  demande_acces: { label: 'Accès hors règle', icon: DoorOpen },
  validation: { label: 'Validation', icon: ShieldCheck },
};

const URGENCE_TON = { haute: 'danger', moyenne: 'warning', basse: 'default' };

export const ONGLETS = [
  { value: 'tous', label: 'Tous' },
  { value: 'conflits', label: 'Conflits' },
  { value: 'demandes', label: 'Demandes' },
  { value: 'validations', label: 'Validations' },
];

/**
 * A-04 — file d'attente, triée par urgence puis par ancienneté.
 *
 * Rendue en liste de boutons plutôt qu'en table : chaque élément se lit d'un
 * coup d'œil et sert de sélecteur pour le volet de droite.
 */
export function QueueList({ items = [], counts = {}, tab, onTabChange, selectedId, onSelect }) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-3">
        {ONGLETS.map((onglet) => (
          <Pill
            key={onglet.value}
            active={tab === onglet.value}
            count={counts[onglet.value] ?? 0}
            onClick={() => onTabChange(onglet.value)}
          >
            {onglet.label}
          </Pill>
        ))}
      </div>

      <ul className="flex flex-col gap-2 p-3">
        {items.map((item, index) => {
          const meta = TYPE_META[item.type] ?? TYPE_META.validation;
          const Icone = meta.icon;
          const actif = selectedId === item.id;
          return (
            <li key={item.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-current={actif ? 'true' : undefined}
                className={cn(
                  'w-full rounded-xl border p-3 text-left transition',
                  actif
                    ? 'border-accent bg-accent-soft'
                    : 'border-line bg-surface-raised hover:border-line-strong',
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Icone size={14} aria-hidden="true" className="shrink-0 text-content-muted" />
                  {/* La référence et non l'identifiant : « #CONF-8492 » se cite au
                      téléphone, un UUID ne se lit pas. */}
                  <span className="font-mono text-[11px] text-content-muted">
                    {item.reference ?? item.id}
                  </span>
                  <Badge tone={URGENCE_TON[item.urgency] ?? 'default'} dot>
                    {item.urgency}
                  </Badge>
                </span>
                <span className="mt-1.5 block truncate text-sm text-content">{item.title}</span>
                <span className="mt-0.5 flex items-center gap-2 text-[11px] text-content-faint">
                  <CalendarClock size={11} aria-hidden="true" />
                  {meta.label} · {fmtRelative(item.createdAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
