import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Checkbox } from '../ui/Form';
import { Pagination } from '../ui/Table';

/**
 * Tableau d'administration : tri par colonne, sélection multiple et pagination.
 * L'état vient de useDataTable ; ce composant ne fait que l'afficher.
 *
 * Sous 1024 px, les pages rendent des cartes à la place. Le basculement était
 * réglé sur 768 px : entre les deux, la barre latérale prenait déjà 240 px et
 * il restait moins de 530 px pour un tableau large de 720 — la ligne défilait
 * horizontalement dans sa carte, et les dernières colonnes ne se voyaient
 * jamais.
 */
export function DataTable({
  columns = [],
  table,
  onRowClick,
  selectable = false,
  rowLabel = 'éléments',
  rowName,
}) {
  // Nom annoncé par la case de sélection. Sans lui, un lecteur d'écran lisait
  // « Sélectionner cb79005a-dc84-40ba… » : l'identifiant technique ne désigne
  // rien pour qui ne voit pas la ligne. À défaut de `rowName`, la première
  // colonne fait office de nom — c'est celle qui identifie la ligne à l'œil.
  const nommer = (row) => {
    const nom = rowName?.(row);
    if (nom) return nom;
    const premiere = columns[0];
    const valeur = premiere?.render ? premiere.render(row) : row[premiere?.key];
    return typeof valeur === 'string' || typeof valeur === 'number' ? String(valeur) : row.id;
  };

  return (
    <div>
      <div className="overflow-x-auto">
        {/* Largeur minimale proportionnelle au nombre de colonnes. Fixée à
            720 px pour toutes, elle imposait un défilement horizontal aux
            tableaux de trois colonnes — le catalogue d'équipements tenait dans
            321 px et s'en voyait refuser deux tiers. Le plafond reste 720 : la
            règle ne peut que réduire, jamais élargir un tableau existant. */}
        <table
          className="w-full border-collapse text-sm"
          style={{ minWidth: `${Math.min(720, (columns.length + (selectable ? 1 : 0)) * 96)}px` }}
        >
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
              // Une ligne cliquable doit s'actionner au clavier. Sans
              // `tabIndex` ni gestionnaire de touche, la seule façon d'ouvrir
              // une fiche à partir de 1024 px était la souris : les listes de
              // cartes, qui portent de vrais boutons, cèdent la place au
              // tableau à cette largeur, et l'écran devenait inutilisable sans
              // pointeur. `aria-label` nomme la cible, `row` reste le rôle —
              // un `role="button"` détruirait la sémantique du tableau.
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick ? `Ouvrir ${nommer(row)}` : undefined}
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
                    <span className="sr-only">Sélectionner {nommer(row)}</span>
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
