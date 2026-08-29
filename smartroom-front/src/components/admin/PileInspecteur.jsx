import { cn } from '../../utils/cn';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Modal } from '../ui/Modal';

/**
 * Vrai en dessous de 1024 px, là où deux colonnes ne tiennent plus.
 *
 * Exporté parce que l'écran doit parfois le savoir avant de rendre : le parc
 * ne retient plus un bâtiment d'office quand la fiche s'ouvre en dialogue,
 * sans quoi on arriverait sur une fiche au lieu de la liste.
 */
export const useIsMobileOuTablette = () => !useMediaQuery('(min-width: 1024px)');

/**
 * Liste et détail : côte à côte au bureau, boîte de dialogue en dessous.
 *
 * Les écrans d'inspection posent leurs colonnes en `lg:grid-cols-[…]`. Sous le
 * seuil, la grille se défait et les panneaux s'empilent : choisir un bâtiment
 * ne changeait rien à l'écran — il fallait deviner qu'une fiche était apparue
 * plus bas, y descendre, puis remonter pour en choisir un autre.
 *
 * En dessous du seuil, la fiche s'ouvre donc **par-dessus** la liste, dans une
 * boîte de dialogue qu'on ferme. La liste reste là où on l'a laissée, avec son
 * défilement : c'est elle le point de départ, la fiche n'est qu'un détour. Une
 * pile qui remplaçait la liste faisait perdre sa position à chaque retour.
 *
 * `Modal` apporte le piège de focus, la fermeture par Échap et le retour du
 * focus à la ligne d'où l'on vient — la même mécanique que partout ailleurs,
 * plutôt qu'une seconde à maintenir.
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
  //: Passé par l'écran quand il a lui-même besoin de connaître le mode, pour
  //: n'évaluer qu'une fois la même requête de média.
  enDialogue,
  className,
}) {
  const coteACoteParDefaut = useMediaQuery(
    seuil === 'xl' ? '(min-width: 1280px)' : '(min-width: 1024px)',
  );
  const coteACote = enDialogue === undefined ? coteACoteParDefaut : !enDialogue;

  if (coteACote) {
    return (
      // `[&>*]:min-w-0` : mesure à l'appui, un enfant de grille sans cette
      // permission refuse de descendre sous la largeur de son contenu et fait
      // défiler la page entière de 178 px.
      <div className={cn('grid gap-5 [&>*]:min-w-0', className)}>
        {liste}
        {detail}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-5 [&>*]:min-w-0">{liste}</div>

      <Modal
        open={actif}
        onClose={onFermer}
        title={titre}
        size="lg"
        footer={
          <button
            type="button"
            onClick={onFermer}
            // 44 px et pleine largeur : c'est la seule sortie de la fiche au
            // doigt, elle doit rester atteignable sans viser.
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-line bg-surface-raised px-4 text-sm text-content transition hover:border-line-strong"
          >
            {libelleFermer}
          </button>
        }
      >
        {detail}
      </Modal>
    </>
  );
}
