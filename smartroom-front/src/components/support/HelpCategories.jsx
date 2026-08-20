import { CalendarPlus, KeyRound, LifeBuoy, Monitor, User, XCircle } from 'lucide-react';
import { cn } from '../../utils/cn';
import { plural } from '../../utils/format';
import { Skeleton } from '../ui/States';

const ICONS = { CalendarPlus, KeyRound, XCircle, Monitor, User };

/**
 * U-22 — catégories d'aide.
 * Une carte active se comporte comme un filtre : on la reclique pour revenir à
 * l'ensemble des articles, sans quitter la page.
 */
export function HelpCategories({ categories = [], active, onSelect, isLoading }) {
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-[70px]" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((category) => {
        const Icon = ICONS[category.icon] ?? LifeBuoy;
        const selected = active === category.id;

        return (
          <button
            key={category.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : category.id)}
            className={cn(
              'flex items-center gap-3 rounded-xl border p-4 text-left transition',
              selected
                ? 'border-accent/60 bg-accent-soft'
                : 'border-line bg-surface hover:border-line-strong hover:bg-surface-raised',
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition',
                selected ? 'border-accent/50 bg-surface' : 'border-line bg-surface-raised',
              )}
            >
              <Icon size={16} aria-hidden="true" className="text-accent" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm text-content">{category.label}</span>
              <span className="block text-xs text-content-muted">
                {plural(category.count, 'article')}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
