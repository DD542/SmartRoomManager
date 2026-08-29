import { Fragment, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useDensite } from '../../hooks/useDensite';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Checkbox } from '../ui/Form';
import { Pagination } from '../ui/Table';
import { colonnesRepliees, colonnesVisibles, valeurCellule } from './colonnes';

/**
 * Tableau d'administration : tri, sélection multiple, pagination — et une
 * seule définition de colonnes pour trois formes.
 *
 *   ≥ 1280 px  toutes les colonnes que la densité autorise ;
 *   768–1279   les colonnes de premier rang, les autres au dépliage de la
 *              ligne ;
 *   < 768 px   une carte par ligne, mêmes règles de dépliage.
 *
 * Aucune page ne connaît ce comportement : elles décrivent leurs colonnes et
 * leur rang, le reste est ici. Six écrans réécrivaient chacun leur bascule en
 * cartes — six copies d'une même idée, et une septième table repartait
 * fatalement sans.
 */
/** Colonnes repliées d'une ligne, en liste de définitions. */
function DetailReplie({ colonnes, row }) {
  if (colonnes.length === 0) return null;
  return (
    <dl className="grid gap-x-4 gap-y-1 [grid-template-columns:auto_1fr]">
      {colonnes.map((colonne) => (
        <div key={colonne.key} className="contents">
          <dt className="text-xs text-content-muted">{colonne.label}</dt>
          <dd className="text-xs text-content">{valeurCellule(colonne, row)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Commande de dépliage.
 *
 * Définie au niveau du module et non dans le corps de `DataTable` : un
 * composant déclaré pendant le rendu change d'identité à chaque passage, React
 * le démonte et le remonte, et l'état d'un nœud — ici `aria-expanded` sur le
 * bouton qu'on vient de presser — se perd entre deux rendus.
 */
function BoutonDetail({ ouvert, onToggle }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      aria-expanded={ouvert}
      // 44 px : ce bouton est la seule voie vers les colonnes repliées, et
      // c'est au doigt qu'on le prend.
      className="inline-flex min-h-[44px] items-center gap-1 text-xs text-accent transition hover:text-accent-hover"
    >
      {ouvert ? 'Masquer le détail' : 'Voir le détail'}
      {ouvert ? (
        <ChevronUp size={12} aria-hidden="true" />
      ) : (
        <ChevronDown size={12} aria-hidden="true" />
      )}
    </button>
  );
}

export function DataTable({
  columns = [],
  table,
  onRowClick,
  selectable = false,
  rowLabel = 'éléments',
  rowName,
}) {
  const enCartes = useMediaQuery('(max-width: 767px)');
  const large = useMediaQuery('(min-width: 1280px)');
  const { compact } = useDensite();
  const [dépliées, setDépliées] = useState([]);

  const visibles = colonnesVisibles(columns, { large, compact });
  const repliees = colonnesRepliees(columns, { large });

  const basculerDetail = (id) =>
    setDépliées((courant) =>
      courant.includes(id) ? courant.filter((item) => item !== id) : [...courant, id],
    );

  // Nom annoncé par la case de sélection. Sans lui, un lecteur d'écran lisait
  // « Sélectionner cb79005a-dc84-40ba… » : l'identifiant technique ne désigne
  // rien pour qui ne voit pas la ligne. À défaut de `rowName`, la première
  // colonne fait office de nom — c'est celle qui identifie la ligne à l'œil.
  const nommer = (row) => {
    const nom = rowName?.(row);
    if (nom) return nom;
    const premiere = columns[0];
    const valeur = valeurCellule(premiere ?? {}, row);
    return typeof valeur === 'string' || typeof valeur === 'number' ? String(valeur) : row.id;
  };

  const cellule = compact ? 'px-3 py-1.5' : 'px-3 py-2.5';

  /* ------------------------------------------------------------------ cartes */

  if (enCartes) {
    return (
      <div>
        {/* `role="list"` explicite : les technologies d'assistance annonçaient
            « liste » sur la table, et rien sur les cartes qui la remplacent. */}
        <ul className="flex flex-col gap-2 p-3">
          {table.rows.map((row, index) => (
            <li
              key={row.id}
              className="animate-fade-in-up rounded-xl border border-line bg-surface-raised p-3"
              style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
            >
              <div className="flex items-start gap-3">
                {selectable && (
                  <Checkbox
                    label=""
                    checked={table.selection.includes(row.id)}
                    onChange={() => table.basculerLigne(row.id)}
                    aria-label={`Sélectionner ${nommer(row)}`}
                  />
                )}

                <div className="min-w-0 flex-1">
                  <dl className="flex flex-col gap-1">
                    {visibles.map((colonne, rang) => (
                      <div
                        key={colonne.key}
                        className={cn(
                          'flex flex-wrap items-baseline gap-x-2',
                          rang === 0 && 'text-sm font-medium text-content',
                        )}
                      >
                        {rang > 0 && (
                          <dt className="text-xs text-content-muted">{colonne.label}</dt>
                        )}
                        <dd className={rang === 0 ? 'text-sm text-content' : 'text-xs text-content'}>
                          {valeurCellule(colonne, row)}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {dépliées.includes(row.id) && (
                    <div className="mt-2 border-t border-line pt-2">
                      <DetailReplie colonnes={repliees} row={row} />
                    </div>
                  )}

                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    {repliees.length > 0 && (
                      <BoutonDetail
                        ouvert={dépliées.includes(row.id)}
                        onToggle={() => basculerDetail(row.id)}
                      />
                    )}
                    {onRowClick && (
                      <button
                        type="button"
                        onClick={() => onRowClick(row)}
                        className="inline-flex min-h-[44px] items-center text-xs text-accent transition hover:text-accent-hover"
                      >
                        Ouvrir {nommer(row)}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

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

  /* ----------------------------------------------------------------- tableau */

  return (
    <div>
      <div className="overflow-x-auto">
        {/* Largeur minimale proportionnelle au nombre de colonnes réellement
            affichées. Fixée à 720 px pour toutes, elle imposait un défilement
            horizontal aux tableaux de trois colonnes — le catalogue
            d'équipements tenait dans 321 px et s'en voyait refuser deux tiers.
            Le plafond reste 720 : la règle ne peut que réduire. */}
        <table
          className="w-full border-collapse text-sm"
          style={{ minWidth: `${Math.min(720, (visibles.length + (selectable ? 1 : 0)) * 96)}px` }}
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
              {visibles.map((column) => {
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
              {repliees.length > 0 && (
                <th scope="col" className="w-32 px-3 py-2.5">
                  <span className="sr-only">Colonnes repliées</span>
                </th>
              )}
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
              <Fragment key={row.id}>
                <tr
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
                    <td className={cellule} onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        label=""
                        checked={table.selection.includes(row.id)}
                        onChange={() => table.basculerLigne(row.id)}
                        aria-label={`Sélectionner ${nommer(row)}`}
                      />
                    </td>
                  )}
                  {visibles.map((column) => (
                    <td
                      key={column.key}
                      className={cn(cellule, 'align-middle', column.align === 'right' && 'text-right')}
                    >
                      {valeurCellule(column, row)}
                    </td>
                  ))}
                  {repliees.length > 0 && (
                    <td className={cellule} onClick={(event) => event.stopPropagation()}>
                      <BoutonDetail
                        ouvert={dépliées.includes(row.id)}
                        onToggle={() => basculerDetail(row.id)}
                      />
                    </td>
                  )}
                </tr>

                {dépliées.includes(row.id) && repliees.length > 0 && (
                  <tr className="border-b border-line/60 bg-surface">
                    <td
                      colSpan={visibles.length + (selectable ? 1 : 0) + 1}
                      className="px-3 pb-3 pt-0"
                    >
                      <DetailReplie colonnes={repliees} row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
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
