import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn';
import { IconButton } from './Button';

/**
 * Tableau de données. Sous 768px, `MobileCards` prend le relais côté page :
 * le tableau lui-même reste scrollable horizontalement dans son conteneur.
 */
export function Table({ columns = [], rows = [], caption, rowKey = (row) => row.id, onRowClick, className }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-content-muted',
                  column.align === 'right' && 'text-right',
                  column.className,
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-line/60 transition last:border-0',
                onRowClick && 'cursor-pointer hover:bg-surface-raised',
                'animate-fade-in-up',
              )}
              style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn('px-4 py-3 align-middle', column.align === 'right' && 'text-right', column.cellClassName)}
                >
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page = 1, pageCount = 1, total = 0, pageSize = 10, onChange, label = 'éléments' }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-content-muted"
      aria-label="Pagination"
    >
      <p>
        Affichage de {from} à {to} sur {total} {label}
      </p>
      <div className="flex items-center gap-1">
        <IconButton
          icon={ChevronLeft}
          label="Page précédente"
          disabled={page <= 1}
          onClick={() => onChange?.(page - 1)}
        />
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange?.(value)}
            aria-current={value === page ? 'page' : undefined}
            className={cn(
              'h-8 min-w-8 rounded-lg border px-2 text-xs transition',
              value === page
                ? 'border-accent bg-accent text-white'
                : 'border-line bg-surface text-content-muted hover:text-content',
            )}
          >
            {value}
          </button>
        ))}
        <IconButton
          icon={ChevronRight}
          label="Page suivante"
          disabled={page >= pageCount}
          onClick={() => onChange?.(page + 1)}
        />
      </div>
    </nav>
  );
}

/** Découpe une liste pour la pagination côté client. */
export function paginate(items = [], page = 1, pageSize = 10) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  return {
    page: safePage,
    pageCount,
    total: items.length,
    pageSize,
    items: items.slice((safePage - 1) * pageSize, safePage * pageSize),
  };
}
