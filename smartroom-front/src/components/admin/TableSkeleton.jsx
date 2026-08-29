import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useDensite } from '../../hooks/useDensite';
import { colonnesVisibles } from './colonnes';
import { Skeleton } from '../ui/States';

/**
 * Attente d'un tableau d'administration, dans la forme qu'il prendra.
 *
 * Les écrans montraient une carte grise pendant le chargement, puis un tableau
 * de dix colonnes : la page sautait au moment où les données arrivaient. Un
 * squelette n'a d'utilité que s'il occupe la place du contenu attendu — sinon
 * il annonce une chose et en livre une autre.
 *
 * Il lit la même définition de colonnes que `DataTable`, et bascule aux mêmes
 * largeurs : impossible que l'un montre des cartes pendant que l'autre prépare
 * un tableau.
 */
export function TableSkeleton({ columns = [], rows = 6, selectable = false }) {
  const enCartes = useMediaQuery('(max-width: 767px)');
  const large = useMediaQuery('(min-width: 1280px)');
  const { compact } = useDensite();

  const visibles = colonnesVisibles(columns, { large, compact });
  const lignes = Array.from({ length: rows }, (_, index) => index);

  if (enCartes) {
    return (
      <ul aria-hidden="true" className="flex flex-col gap-2 p-3">
        {lignes.map((index) => (
          <li key={index} className="rounded-xl border border-line bg-surface-raised p-3">
            <Skeleton rounded="rounded" className="h-4 w-2/3" />
            <div className="mt-2 flex flex-col gap-1.5">
              {visibles.slice(1).map((colonne) => (
                <Skeleton key={colonne.key} rounded="rounded" className="h-3 w-1/2" />
              ))}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div aria-hidden="true" className="px-3 py-2">
      <div
        className="grid gap-3 border-b border-line pb-2"
        style={{
          gridTemplateColumns: `${selectable ? '2rem ' : ''}repeat(${visibles.length}, minmax(0, 1fr))`,
        }}
      >
        {selectable && <Skeleton rounded="rounded" className="h-3 w-4" />}
        {visibles.map((colonne) => (
          <Skeleton key={colonne.key} rounded="rounded" className="h-3 w-24" />
        ))}
      </div>

      {lignes.map((index) => (
        <div
          key={index}
          className={`grid gap-3 border-b border-line/60 ${compact ? 'py-2' : 'py-3'}`}
          style={{
            gridTemplateColumns: `${selectable ? '2rem ' : ''}repeat(${visibles.length}, minmax(0, 1fr))`,
          }}
        >
          {selectable && <Skeleton rounded="rounded" className="h-4 w-4" />}
          {visibles.map((colonne) => (
            <Skeleton key={colonne.key} rounded="rounded" className="h-4 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
