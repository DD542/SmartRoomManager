import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn';
import { IconButton } from './Button';

/**
 * Tableau de données. Sous 768 px, les composants appelants rendent des cartes
 * — `BookingTable` et `TicketTable` le font tous deux — et le tableau lui-même
 * reste défilable horizontalement dans son conteneur.
 *
 * La largeur minimale est proportionnelle au nombre de colonnes, comme celle
 * du tableau d'administration. Fixée à 640 px pour toutes, elle imposait un
 * défilement horizontal à un tableau de trois colonnes qui tenait dans 288 px.
 * Le plafond reste 640 : la règle ne peut que réduire.
 */
export function Table({ columns = [], rows = [], caption, rowKey = (row) => row.id, onRowClick, className }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table
        className="w-full border-collapse text-sm"
        style={{ minWidth: `${Math.min(640, columns.length * 96)}px` }}
      >
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

/**
 * Fenêtre de pages autour de la page courante, bornée à sept boutons.
 *
 * Les rendre toutes semblait inoffensif tant qu'il y en avait cinq. À
 * quarante, la rangée débordait de sa carte : le bouton « page suivante », posé
 * en fin de rangée, sortait de l'écran, et l'écran des réservations n'avait
 * plus aucun moyen d'avancer — les numéros visibles s'arrêtaient à 22 sur 40.
 *
 * `null` marque une coupure, rendue en points de suspension.
 */
export function fenetreDePages(page, pageCount, autour = 1) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const pages = new Set([1, pageCount]);
  for (let valeur = page - autour; valeur <= page + autour; valeur += 1) {
    if (valeur > 1 && valeur < pageCount) pages.add(valeur);
  }
  // Les extrémités gardent une fenêtre pleine : sans cela, aller de la page 1
  // à la page 3 demandait deux gestes au lieu d'un.
  if (page <= 3) [2, 3, 4].forEach((valeur) => valeur < pageCount && pages.add(valeur));
  if (page >= pageCount - 2) {
    [pageCount - 3, pageCount - 2, pageCount - 1].forEach((valeur) => valeur > 1 && pages.add(valeur));
  }

  const triees = [...pages].sort((a, b) => a - b);
  return triees.flatMap((valeur, index) =>
    index > 0 && valeur - triees[index - 1] > 1 ? [null, valeur] : [valeur],
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
        {fenetreDePages(page, pageCount).map((valeur, index) =>
          valeur === null ? (
            <span key={`coupure-${index}`} aria-hidden="true" className="px-1 text-content-faint">
              …
            </span>
          ) : (
            <button
              key={valeur}
              type="button"
              onClick={() => onChange?.(valeur)}
              aria-current={valeur === page ? 'page' : undefined}
              aria-label={`Page ${valeur}`}
              className={cn(
                'h-8 min-w-8 rounded-lg border px-2 text-xs transition',
                valeur === page
                  ? 'border-accent bg-accent text-ink'
                  : 'border-line bg-surface text-content-muted hover:text-content',
              )}
            >
              {valeur}
            </button>
          ),
        )}
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
