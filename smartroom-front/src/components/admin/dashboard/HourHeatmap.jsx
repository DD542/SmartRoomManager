import { useState } from 'react';
import { cn } from '../../../utils/cn';
import { WEEK_DAYS } from '../../../utils/dates';
import { plural } from '../../../utils/format';
import { Card, CardHeader } from '../../ui/Card';

/**
 * A-01 — densité d'occupation par jour ouvré et par heure.
 *
 * Rendue en vrai tableau : les lecteurs d'écran annoncent « Mardi, 14 h,
 * 2 réservations » sans dépendre de la couleur, qui ne porte ici qu'un rappel.
 * La légende de la cellule survolée s'affiche au-dessus plutôt qu'en infobulle
 * flottante, pour rester lisible au clavier comme à la souris.
 */
/**
 * Cinq teintes, du plus creux au plus dense.
 *
 * L'échelle était une opacité continue de 0,18 à 0,80 appliquée au rapport de
 * la case au maximum du tableau. Deux choses la rendaient illisible : cent
 * cinquante nuances d'un même bleu ne se distinguent pas à l'œil, et un
 * rapport au maximum écrase toute la distribution quand une seule case
 * culmine — les cinquante-neuf autres se retrouvaient dans le même quart bas.
 *
 * Cinq crans se comptent, et la légende les montre. La teinte change en même
 * temps que l'opacité : la variation d'une seule dimension est trop faible sur
 * un fond sombre.
 */
const NIVEAUX = [
  { fond: 'rgba(91,155,255,0.10)', bord: 'rgba(91,155,255,0.20)' },
  { fond: 'rgba(91,155,255,0.28)', bord: 'rgba(91,155,255,0.35)' },
  { fond: 'rgba(108,192,255,0.48)', bord: 'rgba(108,192,255,0.55)' },
  { fond: 'rgba(128,220,235,0.70)', bord: 'rgba(128,220,235,0.75)' },
  { fond: 'rgba(160,240,205,0.92)', bord: 'rgba(160,240,205,1)' },
];

/**
 * Seuils séparant les cinq crans, tirés de la distribution réelle.
 *
 * Des quantiles et non des tranches égales : les réservations se concentrent
 * aux heures ouvrables, et découper l'intervalle en cinq parts égales
 * laisserait quatre crans vides. Chaque cran porte ainsi à peu près le même
 * nombre de cases, ce qui est précisément ce qu'on veut comparer.
 */
function seuils(valeurs) {
  const positives = valeurs.filter((valeur) => valeur > 0).sort((a, b) => a - b);
  if (positives.length === 0) return [];
  return [0.2, 0.4, 0.6, 0.8].map(
    (part) => positives[Math.min(positives.length - 1, Math.floor(positives.length * part))],
  );
}

const cran = (valeur, bornes) => bornes.filter((borne) => valeur > borne).length;

export function HourHeatmap({ heatmap, className }) {
  const [survolee, setSurvolee] = useState(null);
  const { hours = [], days = [], cells = [] } = heatmap ?? {};

  const cellule = (day, hour) => cells.find((item) => item.day === day && item.hour === hour);
  const bornes = seuils(cells.map((item) => item.value));
  const libelleJour = (value) => WEEK_DAYS.find((jour) => jour.value === value)?.label ?? '';

  return (
    // `min-w-0` : sans lui, un enfant de grille refuse de descendre sous la
    // largeur de son contenu — `overflow-x-auto` plus bas ne clippait alors
    // rien du tout, et c'est la page entière qui défilait latéralement. C'est
    // la cause du défilement constaté, pas la taille des cases.
    <Card className={cn('min-w-0', className)}>
      <CardHeader
        title="Densité horaire"
        subtitle="Réservations par jour ouvré et par heure"
        action={
          <p className="text-xs text-content-muted" aria-live="polite">
            {survolee
              ? `${libelleJour(survolee.day)} ${survolee.hour} h — ${plural(survolee.value, 'réservation')}`
              : 'Survolez une case'}
          </p>
        }
      />

      {/* Aucun défilement : douze colonnes et cinq lignes tiennent dans
          360 px si on cesse de leur imposer une largeur. Une carte de densité
          se lit d'un coup d'œil — celle qu'il faut faire défiler ne dit plus
          où sont les pics, qui sont précisément ce qu'on y cherche. Les cases
          rétrécissent, l'information reste entière. */}
      <div className="px-3 pb-4 sm:px-4">
        {/* La largeur minimale ne s'applique qu'à partir de 640 px. Imposée à
            520 sur un écran de 375, elle faisait défiler la page entière de
            155 px : le conteneur `overflow-x-auto` ci-dessus ne suffisait pas à
            la contenir. Sous ce seuil les cases se resserrent, ce qu'une carte
            de densité supporte — la couleur porte l'information, et chaque case
            garde son libellé pour les lecteurs d'écran. */}
        {/* Largeur minimale à toutes les largeurs, une fois le clipping
            réparé : à 375 px, douze colonnes tassées donnaient des cases de
            22 px que ni l'œil ni le doigt ne séparaient. Mieux vaut un
            défilement horizontal franc, contenu dans la carte, que douze
            colonnes illisibles. */}
        <table className="w-full table-fixed border-separate border-spacing-0.5 text-xs sm:border-spacing-1">
          <caption className="sr-only">
            Nombre de réservations par jour de la semaine et par heure d’ouverture
          </caption>
          <thead>
            <tr>
              {/* Colonne des jours : étroite au téléphone, où chaque pixel
                  qu'elle prend est un pixel de moins pour les douze heures. */}
              <th scope="col" className="w-7 sm:w-10">
                <span className="sr-only">Jour</span>
              </th>
              {hours.map((hour) => (
                <th
                  key={hour}
                  scope="col"
                  className="pb-1 font-mono text-[9px] font-normal text-content-faint sm:text-[10px]"
                >
                  {/* « 8 » et non « 8h » sous 640 px : la lettre ajoutait
                      six pixels par colonne, soit soixante-douze sur douze
                      colonnes — la moitié de ce qui manquait. L'unité est
                      dans le titre de la carte. */}
                  <span className="sm:hidden">{hour}</span>
                  <span className="hidden sm:inline">{hour}h</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day}>
                <th
                  scope="row"
                  className="pr-1 text-right text-[11px] font-normal text-content-muted"
                >
                  {libelleJour(day).slice(0, 3)}
                </th>
                {hours.map((hour) => {
                  const item = cellule(day, hour) ?? { value: 0, ratio: 0 };
                  const actif = survolee?.day === day && survolee?.hour === hour;
                  return (
                    <td key={hour} className="p-0">
                      <button
                        type="button"
                        onMouseEnter={() => setSurvolee({ day, hour, value: item.value })}
                        onMouseLeave={() => setSurvolee(null)}
                        onFocus={() => setSurvolee({ day, hour, value: item.value })}
                        onBlur={() => setSurvolee(null)}
                        className={cn(
                          // 20 px de haut au telephone : a 360 px une case fait 15 px de large, et
                          // une case deux fois plus haute que large ne se lit plus
                          // comme une densite mais comme une barre.
                          'h-5 w-full rounded border transition duration-200 sm:h-7 sm:rounded-md',
                          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                          item.value === 0 && 'border-line/60 bg-surface-raised/40',
                          actif && 'ring-1 ring-accent',
                        )}
                        style={
                          item.value > 0
                            ? {
                                background: NIVEAUX[cran(item.value, bornes)].fond,
                                borderColor: NIVEAUX[cran(item.value, bornes)].bord,
                              }
                            : undefined
                        }
                      >
                        <span className="sr-only">
                          {libelleJour(day)} {hour} h : {plural(item.value, 'réservation')}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <Legende />
      </div>
    </Card>
  );
}

function Legende() {
  return (
    <p className="mt-3 flex items-center gap-2 text-[11px] text-content-faint">
      Faible
      {/* Les mêmes teintes que les cases, tirées de la même table : deux
          listes écrites séparément finissent par diverger. */}
      {NIVEAUX.map((niveau) => (
        <span
          key={niveau.fond}
          aria-hidden="true"
          className="h-3 w-5 rounded-sm border"
          style={{ background: niveau.fond, borderColor: niveau.bord }}
        />
      ))}
      Forte
    </p>
  );
}
