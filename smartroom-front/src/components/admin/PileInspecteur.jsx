import { X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/**
 * Liste et détail : côte à côte au bureau, l'un **ou** l'autre en dessous.
 *
 * Les écrans d'inspection posent leurs colonnes en `lg:grid-cols-[…]`. Sous le
 * seuil, la grille se défait et les panneaux s'empilent : choisir un bâtiment
 * ne changeait donc rien à l'écran — il fallait deviner qu'une fiche était
 * apparue plus bas, y descendre, puis remonter pour en choisir un autre. Sur
 * six bâtiments et trois écrans de fiche, cela fait beaucoup d'allers-retours
 * pour un pouce.
 *
 * En dessous du seuil, le détail prend donc toute la place, comme un écran à
 * part entière, et se referme par un bouton explicite. Au bureau, rien ne
 * change : c'est la cible principale du back-office.
 *
 * Le bouton de fermeture est placé avant le détail dans l'ordre du document :
 * au clavier, on l'atteint sans traverser la fiche entière.
 */
export function PileInspecteur({
  liste,
  detail,
  actif = false,
  onFermer,
  titre,
  libelleFermer = 'Fermer',
  //: Point de rupture au-delà duquel les deux surfaces tiennent ensemble.
  //: `lg` pour deux colonnes, `xl` pour trois — c'est la largeur que l'écran
  //: demandait déjà, on ne la réinvente pas.
  seuil = 'lg',
  className,
}) {
  const coteACote = useMediaQuery(seuil === 'xl' ? '(min-width: 1280px)' : '(min-width: 1024px)');

  if (coteACote) {
    // Un fragment et non un tableau : un tableau d'éléments réclamerait des
    // clés, et React s'en plaindrait à chaque rendu pour deux enfants fixes.
    return (
      // `[&>*]:min-w-0` : mesure a l'appui, un enfant de grille sans cette
      // permission refuse de descendre sous la largeur de son contenu et fait
      // defiler la page entiere de 178 px.
      <div className={cn('grid gap-5 [&>*]:min-w-0', className)}>
        {liste}
        {detail}
      </div>
    );
  }

  if (!actif) return <div className="grid gap-5 [&>*]:min-w-0">{liste}</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-raised px-3 py-2">
        <span className="min-w-0 truncate text-sm font-medium text-content">{titre}</span>
        <button
          type="button"
          onClick={onFermer}
          // 44 px : ce bouton est la seule sortie de la fiche sur un écran
          // étroit, et c'est au pouce qu'on le prend.
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 text-xs text-content-muted transition hover:text-content"
        >
          <X size={15} aria-hidden="true" />
          {libelleFermer}
        </button>
      </div>
      {detail}
    </div>
  );
}
