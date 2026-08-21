import { Search } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Champ de recherche des barres de filtres d'administration.
 *
 * `type="search"` fournit la croix d'effacement native ; le libellé reste
 * présent pour les lecteurs d'écran, la loupe n'étant qu'un repère visuel.
 */
export function SearchInput({ label, value, onChange, placeholder, className }) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <Search
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 text-content-faint"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          'h-8 w-56 rounded-lg border border-line bg-surface-raised pl-7 pr-2.5 text-xs',
          'text-content placeholder:text-content-faint focus:border-accent focus:outline-none',
          className,
        )}
      />
    </label>
  );
}
