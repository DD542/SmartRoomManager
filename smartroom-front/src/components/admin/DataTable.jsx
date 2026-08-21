import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Checkbox } from '../ui/Form';
import { Pagination } from '../ui/Table';

/**
 * Tableau d'administration : tri par colonne, sélection multiple et pagination.
 * L'état vient de useDataTable ; ce composant ne fait que l'afficher.
 *
 * Sous 768px, les pages rendent des cartes à la place : un tableau de huit
 * colonnes n'est pas consultable au doigt.
 */
export function DataTable({ columns = [], table, onRowClick, selectable = false, rowLabel = 'éléments' }) {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {selectable && (
                <th scope="col" className="w-10 px-3 py-2.5">
                  <Checkbox
                    label=""
                    checked={table.toutesSelectionnees}
                    onChange={table.basculerPage}
                  />
                  <span className="sr-only">Tout sélectionner sur cette page</span>
                </th>
              )}
              {columns.map((column) => {
                const trie = table.sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    // aria-sort se porte sur la cellule d'en-tête, pas sur le
                    // bouton qu'elle contient : sur le bouton, aucun lecteur
                    // d'écran n'annonce le sens du tri.
                    aria-sort={
                      trie ? (table.sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                    className={cn(
                      'px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-content-muted',
                      column.align === 'right' && 'text-right',
                    )}
                  >
                    {column.sortable === false ? (
                      column.label
                    ) : (
                      <button
                        type="button"
                        onClick={() => table.basculerTri(column.key)}
                        className="inline-flex items-center gap-1 transition hover:text-content"
                      >
                        {column.label}
                        {trie &&
                          (table.sort.direction === 'asc' ? (
                            <ChevronUp size={12} aria-hidden="true" />
                          ) : (
                            <ChevronDown size={12} aria-hidden="true" />
                          ))}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {table.rows.map((row, index) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'animate-fade-in-up border-b border-line/60 transition last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-surface-raised',
                  table.selection.includes(row.id) && 'bg-accent-soft',
                )}
                style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
              >
                {selectable && (
                  <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      label=""
                      checked={table.selection.includes(row.id)}
                      onChange={() => table.basculerLigne(row.id)}
                    />
                    <span className="sr-only">Sélectionner {row.id}</span>
                  </td>
                )}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn('px-3 py-2.5 align-middle', column.align === 'right' && 'text-right')}
                  >
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={table.page}
        pageCount={table.pageCount}
        total={table.total}
        pageSize={table.pageSize}
        onChange={table.setPage}
        label={rowLabel}
      />
    </div>
  );
}
