import { ChevronLeft } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/**
 * Liste et détail : côte à côte au bureau, l'un **ou** l'autre en dessous.
 *
 * Les écrans d'inspection posaient leurs deux colonnes en `lg:grid-cols-[…]`.
 * Sous le seuil, la grille se défait et les panneaux s'empilent : la liste
 * d'abord, le détail dessous. Ouvrir un élément ne changeait donc rien à
 * l'écran — il fallait deviner qu'une réponse était apparue plus bas, y
 * descendre, puis remonter pour choisir le suivant. Sur une file d'arbitrage
 * de trente lignes, cela fait trente allers-retours.
 *
 * Une pile règle cela sans dupliquer l'écran : le même détail, la même liste,
 * mais une seule des deux surfaces à la fois, et un retour explicite. Au
 * bureau, rien ne change — c'est la cible principale du back-office.
 *
 * Le retour est un vrai bouton, placé avant le détail dans l'ordre de
 * tabulation : au clavier, on l'atteint sans traverser la fiche entière.
 */
export function PileInspecteur({
  liste,
  detail,
  actif = false,
  onRetour,
  libelleRetour = 'Retour à la liste',
  //: Point de rupture au-delà duquel les deux surfaces tiennent ensemble.
  //: `lg` pour deux colonnes, `xl` pour trois — c'est la largeur que
  //: l'écran demandait déjà.
  seuil = 'lg',
  className,
}) {
  const cote_a_cote = useMediaQuery(seuil === 'xl' ? '(min-width: 1280px)' : '(min-width: 1024px)');

  if (cote_a_cote) {
    // Un fragment et non un tableau : un tableau d'éléments réclamerait des
    // clés, et React s'en plaindrait à chaque rendu pour deux enfants fixes.
    return (
      <div className={cn('grid gap-4', className)}>
        {liste}
        {detail}
      </div>
    );
  }

  if (!actif) return <div className="grid gap-4">{liste}</div>;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onRetour}
        className="inline-flex min-h-[44px] w-fit items-center gap-1 text-xs text-content-muted transition hover:text-content"
      >
        <ChevronLeft size={14} aria-hidden="true" />
        {libelleRetour}
      </button>
      {detail}
    </div>
  );
}
