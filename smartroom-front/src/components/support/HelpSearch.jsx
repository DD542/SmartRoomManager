import { Search, X } from 'lucide-react';
import { Card } from '../ui/Card';

/** U-22 — bandeau de recherche du centre d'aide. */
export function HelpSearch({ value, onChange }) {
  return (
    <Card className="px-4 py-8 text-center">
      <h2 className="text-xl font-semibold text-content">Comment pouvons-nous vous aider ?</h2>
      <div className="relative mx-auto mt-4 max-w-lg">
        <label htmlFor="recherche-aide" className="sr-only">
          Rechercher un article d’aide
        </label>
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
        />
        <input
          id="recherche-aide"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Conflit, code d’accès, annulation, badge…"
          className="h-11 w-full rounded-xl border border-line bg-surface-raised pl-10 pr-10 text-sm text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Effacer la recherche"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-content-muted transition hover:text-content"
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </Card>
  );
}
